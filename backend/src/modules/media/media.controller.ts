import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import {
  baixarExterno,
  OrigemRecusadaError,
  RespostaGrandeDemaisError,
} from './download-externo';
import { MediaMirrorService } from './media-mirror.service';

/** Tipo pela extensão, para CDNs que respondem octet-stream. */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

function mimeFromExtension(pathname: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(pathname)?.[1]?.toLowerCase();
  return ext ? (MIME_BY_EXT[ext] ?? null) : null;
}

/** Teto de resposta: sem ele, uma URL de 5 GB derruba o processo por memória. */
const MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/**
 * Proxy de imagens: CDNs de terceiros (TikTok, Shopee, Mercado Livre...)
 * bloqueiam hotlink pelo Referer do navegador, mas respondem a requisições
 * de servidor. Sem auth (é usado em <img>), com cache agressivo.
 */
@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly mirror: MediaMirrorService) {}

  /**
   * Serve a mídia espelhada quando o bucket é PRIVADO.
   *
   * Assim nenhum objeto fica exposto publicamente na internet e, ao mesmo
   * tempo, a URL guardada no banco nunca expira — diferente das assinadas do
   * fornecedor, que morrem em ~72h. Sem auth porque é consumido em <img>.
   */
  // Express 4 (Nest 10) nomeia o wildcard como "0"; a chave tem barras, então
  // precisa ser wildcard e não um :param simples.
  @Get('s3/*')
  @ApiOperation({ summary: 'Serve mídia espelhada no S3 (bucket privado)' })
  async fromS3(
    @Param('0') key: string,
    @Res() res: Response,
    @Headers('range') range?: string,
  ) {
    // Allowlist em vez de bloquear "..": a chave é montada por nós (prefixo +
    // hash + extensão), então tudo que foge desse formato é tentativa de
    // alcançar outro objeto do bucket. Decodifica antes de validar, senão
    // "%2e%2e%2f" passaria pela checagem e viraria "../" no S3.
    let objectKey: string;
    try {
      objectKey = decodeURIComponent(key ?? '');
    } catch {
      throw new BadRequestException('Chave inválida');
    }
    if (!objectKey || !/^[A-Za-z0-9._\-/]+$/.test(objectKey)) {
      throw new BadRequestException('Chave inválida');
    }
    if (objectKey.includes('..') || objectKey.startsWith('/')) {
      throw new BadRequestException('Chave inválida');
    }

    const object = await this.mirror.readObject(objectKey);
    if (!object) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', object.contentType);
    // A chave contém o hash da origem: o conteúdo nunca muda.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    /*
     * Range é o que torna o vídeo navegável.
     *
     * Sem `Accept-Ranges` e sem resposta 206, o Chrome trata o MP4 como um
     * fluxo que só dá para assistir do começo: `video.seekable` fica vazio, a
     * barra do player não arrasta e qualquer `currentTime = x` é ignorado em
     * silêncio. Conferir um vídeo montado virava assistir ao vídeo inteiro.
     *
     * O corpo já está inteiro em memória (`readObject` lê e cacheia), então
     * atender o pedido é fatiar o Buffer — não há segunda ida ao S3.
     */
    const total = object.body.length;
    res.setHeader('Accept-Ranges', 'bytes');

    const pedido = /^bytes=(\d*)-(\d*)$/.exec(range?.trim() ?? '');
    if (!pedido) {
      res.setHeader('Content-Length', total);
      res.send(object.body);
      return;
    }

    // `bytes=-500` pede os últimos 500; `bytes=500-` pede do 500 ao fim.
    const [, inicioBruto, fimBruto] = pedido;
    const inicio = inicioBruto
      ? Number(inicioBruto)
      : Math.max(total - Number(fimBruto || 0), 0);
    const fim = inicioBruto
      ? Math.min(fimBruto ? Number(fimBruto) : total - 1, total - 1)
      : total - 1;

    if (!Number.isFinite(inicio) || inicio > fim || inicio >= total) {
      // 416 precisa dizer qual é o tamanho real, senão o player fica repetindo
      // o mesmo pedido inválido.
      res.setHeader('Content-Range', `bytes */${total}`);
      res.status(416).end();
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${inicio}-${fim}/${total}`);
    res.setHeader('Content-Length', fim - inicio + 1);
    res.end(object.body.subarray(inicio, fim + 1));
  }

  /*
   * O teto de requisições aqui é conta de banda, não de abuso genérico.
   *
   * A rota é anônima e cada resposta pode chegar a MAX_BYTES: a 120/min, um
   * único IP conseguia arrastar 2,4 GB por minuto do nosso egress — tráfego
   * que nós pagamos, sem nenhum login por trás. 40/min mantém a galeria
   * carregando (uma tela pede ~20 imagens) e derruba o pior caso para 800MB.
   */
  @Get('proxy')
  @ApiOperation({ summary: 'Proxy de imagem externa (contorna bloqueio de hotlink)' })
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  async proxy(@Query('url') url: string, @Res() res: Response) {
    // Todas as defesas contra SSRF (https, host público, IP fixado na conexão,
    // redirect revalidado, teto de bytes e de tempo) vivem em
    // `download-externo`, compartilhado com o espelhamento no S3 — ver o
    // cabeçalho daquele arquivo.
    let externo;
    try {
      externo = await baixarExterno(url, {
        maxBytes: MAX_BYTES,
        timeoutMs: FETCH_TIMEOUT_MS,
        maxRedirects: MAX_REDIRECTS,
        headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      });
    } catch (erro) {
      if (erro instanceof RespostaGrandeDemaisError) {
        res.status(413).end();
        return;
      }
      if (erro instanceof OrigemRecusadaError) {
        // URL inválida e host proibido são erro de quem pediu (400); origem que
        // não respondeu é falha de terceiro (502). A mensagem não diferencia
        // "host bloqueado" de "host inexistente" de propósito: responder
        // diferente para cada um transformaria a rota num varredor de rede
        // interna, que é exatamente o que ela não pode ser.
        res.status(erro.message.startsWith('Origem') ? 502 : 400).end();
        return;
      }
      throw erro;
    }

    // Alguns CDNs (o do EchoTik, por exemplo) servem imagem como
    // "binary/octet-stream". Recusar por isso deixava o produto sem foto, então
    // caímos para a extensão do arquivo antes de desistir.
    const contentType = /^(image|video)\//.test(externo.contentType)
      ? externo.contentType
      : mimeFromExtension(externo.urlFinal.pathname);
    if (!contentType) {
      res.status(415).end();
      return;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // Impede que o navegador interprete a resposta como outro tipo caso o
    // upstream sirva algo que não é imagem sob um content-type de imagem.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(externo.buffer);
  }
}
