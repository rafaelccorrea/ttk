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
import * as ipaddr from 'ipaddr.js';
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

/**
 * Anti-SSRF. O proxy é anônimo e busca uma URL que o cliente escolhe, então
 * ele é um pedido HTTP feito de dentro da rede — exatamente o que um atacante
 * quer para alcançar o metadata da cloud (169.254.169.254) ou serviços que só
 * escutam em localhost.
 *
 * A verificação é sobre o IP RESOLVIDO, não sobre o texto do host: qualquer
 * domínio público pode ter um registro A apontando para 127.0.0.1, e uma
 * blocklist de strings não vê isso.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  const { lookup } = await import('dns/promises');
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BadRequestException('Host não permitido');
  }
  for (const { address } of addresses) {
    const ip = ipaddr.parse(address);
    const range = ip.range();
    // 'unicast' é o único intervalo roteável na internet pública. Todo o
    // resto (loopback, private, linkLocal — onde vive o metadata —, uniqueLocal,
    // carrierGradeNat, reserved) fica de fora.
    if (range !== 'unicast') {
      throw new BadRequestException('Host não permitido');
    }
    // IPv4 mapeado em IPv6 (::ffff:127.0.0.1) passa como unicast no IPv6.
    if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
      if ((ip as ipaddr.IPv6).toIPv4Address().range() !== 'unicast') {
        throw new BadRequestException('Host não permitido');
      }
    }
  }
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

  @Get('proxy')
  @ApiOperation({ summary: 'Proxy de imagem externa (contorna bloqueio de hotlink)' })
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  async proxy(@Query('url') url: string, @Res() res: Response) {
    let parsed = this.parseTarget(url);
    await assertPublicHost(parsed.hostname);

    // `redirect: 'manual'`: com 'follow', o fetch segue o 302 sozinho e todas
    // as checagens acima valem só para o primeiro salto — um host público
    // redirecionando para http://169.254.169.254/ passaria direto. Cada salto
    // é revalidado aqui.
    let upstream: globalThis.Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      upstream = await fetch(parsed.toString(), {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const location = upstream.headers.get('location');
      if (upstream.status < 300 || upstream.status >= 400 || !location) {
        break;
      }
      parsed = this.parseTarget(new URL(location, parsed).toString());
      await assertPublicHost(parsed.hostname);
      upstream = undefined;
    }
    if (!upstream || !upstream.ok || !upstream.body) {
      res.status(502).end();
      return;
    }
    // Content-Length é uma dica do upstream, não garantia — o corte real é
    // feito na leitura do corpo, abaixo.
    const declared = Number(upstream.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) {
      res.status(413).end();
      return;
    }
    const upstreamType = upstream.headers.get('content-type') ?? '';
    // Alguns CDNs (o do EchoTik, por exemplo) servem imagem como
    // "binary/octet-stream". Recusar por isso deixava o produto sem foto, então
    // caímos para a extensão do arquivo antes de desistir.
    const contentType = /^(image|video)\//.test(upstreamType)
      ? upstreamType
      : mimeFromExtension(parsed.pathname);
    if (!contentType) {
      res.status(415).end();
      return;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // Impede que o navegador interprete a resposta como outro tipo caso o
    // upstream sirva algo que não é imagem sob um content-type de imagem.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const buffer = await this.readCapped(upstream);
    if (!buffer) {
      res.status(413).end();
      return;
    }
    res.send(buffer);
  }

  /** Aceita só https em host público — nunca IP literal nem outro esquema. */
  private parseTarget(raw: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new BadRequestException('URL inválida');
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('Host não permitido');
    }
    // IP literal não tem por que aparecer numa CDN legítima, e é a forma mais
    // direta de pedir um alvo interno.
    if (ipaddr.isValid(parsed.hostname.replace(/^\[|\]$/g, ''))) {
      throw new BadRequestException('Host não permitido');
    }
    return parsed;
  }

  /** Lê o corpo em pedaços e aborta ao passar do teto. */
  private async readCapped(
    upstream: globalThis.Response,
  ): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = upstream.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
}
