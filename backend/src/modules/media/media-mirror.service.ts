import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { baixarExterno } from './download-externo';

/** Formato único das capas: 9:16, o mesmo do card da vitrine. */
const IMAGE_WIDTH = 540;
const IMAGE_HEIGHT = 960;

/**
 * Tempo máximo esperando a origem. Sem isto, um CDN que aceita a conexão e
 * não responde prende a execução do cron de ingestão para sempre.
 */
const ESPELHAMENTO_TIMEOUT_MS = 20_000;

/** Quantos objetos manter em memória (imagens tratadas pesam ~40KB). */
const OBJECT_CACHE_MAX = 600;

/**
 * Como a imagem preenche o quadro 9:16.
 *  - `cover`: recorta as bordas (capa de vídeo, retrato de persona);
 *  - `contain`: cabe inteira, com faixa branca (foto de produto).
 */
export type AjusteDeImagem = 'cover' | 'contain';

/** Rota que serve os objetos quando o bucket é privado (opção padrão). */
export const MEDIA_ROUTE = '/api/v1/media/s3';

/**
 * Espelha mídia de terceiros no S3.
 *
 * Motivo: todas as URLs que o fornecedor entrega são temporárias —
 *  - capas do EchoTik: assinadas, ~3 dias, e o CDN recusa hotlink (403);
 *  - MP4 da TikTok: assinado, expira em horas (era o vídeo que não tocava).
 *
 * Espelhar resolve os três problemas de uma vez: a URL passa a ser nossa e
 * permanente, não quebra, e deixa de gastar cota da API para ser renovada.
 * O arquivo só é baixado uma vez — se a chave já existe no bucket, pula.
 */
@Injectable()
export class MediaMirrorService {
  /**
   * Objetos já lidos do S3, compartilhados entre requisições. São imutáveis
   * (a chave contém o hash da origem), então não há risco de servir versão
   * velha.
   */
  private static readonly objectCache = new Map<
    string,
    { body: Buffer; contentType: string }
  >();

  private readonly logger = new Logger(MediaMirrorService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicBase: string;
  /** Teto de segurança por arquivo (MP4 de TikTok raramente passa disso). */
  private readonly maxBytes = 40 * 1024 * 1024;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('AWS_S3_BUCKET') ?? '';
    const region = config.get<string>('AWS_REGION') ?? 'us-east-1';
    const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID') ?? '';
    const secretAccessKey = config.get<string>('AWS_SECRET_ACCESS_KEY') ?? '';

    /**
     * Como a mídia chega ao navegador.
     *
     * Sem `AWS_S3_PUBLIC_BASE`, o bucket é tratado como PRIVADO: guardamos um
     * caminho da nossa própria API e o backend lê do S3 com credencial. Assim
     * nenhum objeto fica exposto na internet e nada expira.
     *
     * Com a variável preenchida (CDN ou bucket público), a URL aponta direto
     * para lá e o tráfego não passa por nós.
     */
    this.publicBase = config.get<string>('AWS_S3_PUBLIC_BASE') ?? MEDIA_ROUTE;

    this.client =
      this.bucket && accessKeyId && secretAccessKey
        ? new S3Client({
            region,
            credentials: { accessKeyId, secretAccessKey },
          })
        : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Baixa a URL e guarda no S3 sob `prefix/<hash>.<ext>`, devolvendo a URL
   * pública definitiva. Em qualquer falha devolve `null` — quem chama decide
   * se cai para a URL temporária original.
   */
  async mirror(
    sourceUrl: string | null,
    prefix: string,
    /** Id estável do recurso (product_id, video_id...) para a chave. */
    id: string,
  ): Promise<string | null> {
    if (!this.client || !sourceUrl) return null;

    // A chave ignora a querystring assinada: a mesma imagem renovada não vira
    // um objeto novo a cada execução do cron.
    const clean = sourceUrl.split('?')[0];
    const ext = this.extensionOf(clean);
    const digest = createHash('sha1').update(clean).digest('hex').slice(0, 16);
    const key = `${prefix}/${id}-${digest}${ext}`;

    try {
      // Já espelhado: não baixa de novo.
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return `${this.publicBase}/${key}`;
    } catch {
      // Não existe ainda — segue para o upload.
    }

    try {
      /*
       * O download passa por `baixarExterno`, e não por um `fetch` solto.
       *
       * Esta é uma requisição HTTP saindo de dentro da nossa rede para uma URL
       * que veio de FORA — do fornecedor, sim, mas também do cadastro do
       * cliente: `CampaignsService.espelharFotos` recebe as URLs de fotos do
       * corpo da requisição e chega aqui. O `fetch` que estava neste lugar
       * seguia redirect sozinho, não olhava para onde estava conectando, não
       * tinha tempo limite e lia o corpo inteiro com `arrayBuffer()` ANTES de
       * comparar com `maxBytes` — ou seja, o teto de tamanho só era conferido
       * depois de o arquivo já estar todo na memória.
       *
       * Na prática: um cliente cadastrava uma foto apontando para um serviço
       * interno e usava a nossa API para alcançá-lo (o resultado não volta para
       * ele, mas a diferença entre "espelhou" e "falhou" já mapeia a rede), ou
       * apontava para um arquivo enorme e derrubava o processo.
       *
       * As defesas estão todas num lugar só, junto com as do proxy de imagem —
       * ver o cabeçalho de `download-externo.ts`.
       */
      let externo;
      try {
        externo = await baixarExterno(sourceUrl, {
          maxBytes: this.maxBytes,
          timeoutMs: ESPELHAMENTO_TIMEOUT_MS,
          maxRedirects: 3,
        });
      } catch (erro) {
        this.logger.warn(
          `Espelhamento recusado (${sourceUrl.slice(0, 70)}): ${
            erro instanceof Error ? erro.message : erro
          }`,
        );
        return null;
      }

      const contentType = externo.contentType || 'application/octet-stream';
      const ehVideo = contentType.startsWith('video/');
      const original = externo.buffer;

      /**
       * A validação é por DECODIFICAÇÃO, não pelo `content-type`.
       *
       * O CDN do EchoTik entrega capa legítima como "binary/octet-stream", e
       * confiar no cabeçalho descartava 403 produtos válidos. Por outro lado,
       * página de erro do CDN chega como HTML e já foi guardada como se fosse
       * capa (sobraram 7 objetos ".htm" no bucket). Se o `sharp` abre, é
       * imagem de verdade — nenhum dos dois enganos passa.
       */
      const tratada = ehVideo ? null : await this.normalizarImagem(original);
      if (!tratada && !ehVideo) {
        this.logger.warn(
          `Espelhamento recusado: conteúdo não é imagem (${sourceUrl.slice(0, 70)})`,
        );
        return null;
      }
      const body = tratada?.body ?? original;
      const tipoFinal = tratada ? 'image/webp' : contentType;
      const chaveFinal = tratada ? key.replace(/\.[a-z0-9]+$/i, '.webp') : key;

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: chaveFinal,
          Body: body,
          ContentType: tipoFinal,
          // Imutável: a chave já contém o hash da origem.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${this.publicBase}/${chaveFinal}`;
    } catch (error) {
      this.logger.warn(`Espelhamento falhou (${prefix}/${id}): ${error}`);
      return null;
    }
  }

  /**
   * Guarda uma imagem que já veio em memória — upload do próprio usuário.
   *
   * Passa exatamente pela mesma validação do espelhamento de URL: se o `sharp`
   * não abre, não é imagem e não entra no bucket. Isso vale ainda mais aqui,
   * porque o conteúdo vem de fora e o `content-type` do multipart é escolhido
   * por quem envia.
   *
   * A chave usa o hash do CONTEÚDO: subir a mesma foto duas vezes não cria
   * dois objetos.
   */
  async putImage(
    original: Buffer,
    prefix: string,
    id: string,
    ajuste: AjusteDeImagem = 'cover',
  ): Promise<string | null> {
    if (!this.client || !original?.length) return null;
    if (original.byteLength > this.maxBytes) {
      this.logger.warn(`Upload grande demais (${original.byteLength}b)`);
      return null;
    }

    const tratada = await this.normalizarImagem(original, ajuste);
    if (!tratada) {
      this.logger.warn('Upload recusado: o conteúdo não é uma imagem.');
      return null;
    }

    const digest = createHash('sha1').update(tratada.body).digest('hex').slice(0, 16);
    const key = `${prefix}/${id}-${digest}.webp`;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: tratada.body,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${this.publicBase}/${key}`;
    } catch (error) {
      this.logger.warn(`Upload falhou (${prefix}/${id}): ${error}`);
      return null;
    }
  }

  /**
   * Guarda um MP4 produzido por nós (o vídeo montado da campanha).
   *
   * Sem validação por decodificação aqui, ao contrário das imagens: o arquivo
   * não veio de fora, saiu do nosso próprio ffmpeg. A chave usa o hash do
   * conteúdo, então remontar sem mudar nada não cria objeto novo.
   */
  /** Clipe de áudio (mp3) — ex.: voz-semente da persona. Chave pelo hash do conteúdo. */
  async putAudio(original: Buffer, prefix: string, id: string): Promise<string | null> {
    if (!this.client || !original?.length) return null;
    const digest = createHash('sha1').update(original).digest('hex').slice(0, 16);
    const key = `${prefix}/${id}-${digest}.mp3`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: original,
          ContentType: 'audio/mpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${this.publicBase}/${key}`;
    } catch (error) {
      this.logger.warn(`Upload de áudio falhou (${prefix}/${id}): ${error}`);
      return null;
    }
  }

  async putVideo(
    original: Buffer,
    prefix: string,
    id: string,
  ): Promise<string | null> {
    if (!this.client || !original?.length) return null;
    if (original.byteLength > this.maxBytes) {
      this.logger.warn(`Vídeo grande demais (${original.byteLength}b)`);
      return null;
    }

    const digest = createHash('sha1').update(original).digest('hex').slice(0, 16);
    const key = `${prefix}/${id}-${digest}.mp4`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: original,
          ContentType: 'video/mp4',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${this.publicBase}/${key}`;
    } catch (error) {
      this.logger.warn(`Upload de vídeo falhou (${prefix}/${id}): ${error}`);
      return null;
    }
  }

  /**
   * Padroniza a imagem antes de guardar.
   *
   * As capas chegam com proporções e pesos muito diferentes — quadrada,
   * vertical, às vezes centenas de KB. Isso deixava a vitrine irregular e
   * pesada. Aqui tudo vira o mesmo formato:
   *
   *  - recorte 9:16, que é o formato do card (`cover` sem distorcer);
   *  - largura fixa, suficiente para telas retina sem exagero;
   *  - WebP, que costuma cortar o peso pela metade.
   *
   * Como espelhamos uma única vez, o custo do processamento não se repete.
   * Se algo falhar, devolve `null` e o original é guardado como veio.
   */
  /**
   * Enquadra uma foto de pessoa no 9:16 SEM cortar o rosto.
   *
   * Foto de referência costuma ser quadrada ou horizontal (selfie, avatar).
   * O `cover` 9:16 leva metade da largura embora — e, num rosto, isso é
   * metade da cara. Aqui a foto inteira é centralizada sobre um fundo feito
   * dela mesma, ampliada e desfocada: o retrato fica vertical, sem faixas
   * brancas e sem perder o sujeito. Fotos já verticais passam direto.
   */
  async enquadrarRetrato(original: Buffer): Promise<Buffer | null> {
    try {
      const base = sharp(original).rotate();
      const meta = await base.metadata();
      if (!meta.width || !meta.height) return null;
      if (meta.width / meta.height <= IMAGE_WIDTH / IMAGE_HEIGHT) {
        return base.toBuffer();
      }
      const normalizada = await base.toBuffer();
      const fundo = await sharp(normalizada)
        .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: 'cover' })
        .blur(40)
        .modulate({ brightness: 0.7 })
        .toBuffer();
      const frente = await sharp(normalizada)
        .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: 'inside' })
        .toBuffer();
      return sharp(fundo)
        .composite([{ input: frente, gravity: 'centre' }])
        .png()
        .toBuffer();
    } catch (error) {
      this.logger.warn(`Enquadramento do retrato falhou: ${error}`);
      return null;
    }
  }

  /**
   * Print de tela na proporção de um celular em pé (9:19,5).
   *
   * Print de layout desktop é largo; posto como "a tela do celular", o editor
   * de imagem deitava o aparelho e o esticava até caber — saía um celular que
   * não existe. Recortar para a proporção do display, guiado pelo conteúdo,
   * entrega ao editor exatamente o que uma tela vertical mostraria.
   */
  async recortarParaTelaDeCelular(original: Buffer): Promise<Buffer | null> {
    try {
      const base = sharp(original).rotate();
      const meta = await base.metadata();
      if (!meta.width || !meta.height) return null;
      if (meta.width / meta.height <= 9 / 19.5 + 0.02) return base.png().toBuffer();
      return base
        .resize(1080, 2340, { fit: 'cover', position: sharp.strategy.attention })
        .png()
        .toBuffer();
    } catch (error) {
      this.logger.warn(`Recorte do print falhou: ${error}`);
      return null;
    }
  }

  private async normalizarImagem(
    original: Buffer,
    ajuste: AjusteDeImagem = 'cover',
  ): Promise<{ body: Buffer } | null> {
    /**
     * Foto de produto é `contain`, capa é `cover`.
     *
     * O recorte 9:16 serve para capa de vídeo, onde cortar as bordas não custa
     * nada. Numa foto de PRODUTO ele destrói o assunto: uma imagem quadrada
     * perde quase metade da largura, e o que sobra é uma faixa central onde
     * mal se reconhece o que está à venda. Como essa mesma foto vira o frame
     * da cena de demonstração, o corte apareceria no anúncio.
     *
     * Com `contain` a foto inteira cabe, com faixa branca no que sobra —
     * exatamente o que se vê em anúncio de e-commerce.
     */
    if (ajuste === 'contain') {
      try {
        const body = await sharp(original)
          .rotate()
          .resize(IMAGE_WIDTH, IMAGE_HEIGHT, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          })
          .flatten({ background: '#ffffff' }) // PNG com transparência vira branco
          .webp({ quality: 82 })
          .toBuffer();
        return { body };
      } catch (error) {
        this.logger.warn(`Normalização (contain) falhou: ${error}`);
        return null;
      }
    }

    try {
      const body = await sharp(original)
        .rotate() // respeita o EXIF antes de recortar
        .resize(IMAGE_WIDTH, IMAGE_HEIGHT, {
          fit: 'cover',
          // Recorte guiado pelo conteúdo: evita cortar o produto ao meio.
          position: sharp.strategy.attention,
        })
        .webp({ quality: 82 })
        .toBuffer();
      return { body };
    } catch (error) {
      this.logger.warn(`Normalização da imagem falhou: ${error}`);
      return null;
    }
  }

  /**
   * Lê um objeto do bucket. Usado pela rota que serve mídia quando o bucket é
   * privado — é o que substitui deixar tudo público.
   */
  async readObject(
    key: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    if (!this.client || !key) return null;

    // Cache em memória. Cada leitura no S3 custa 300ms–1s, e uma tela de
    // vitrine pede ~30 imagens de uma vez — como o navegador só abre ~6
    // conexões por origem, isso virava fila e os cards ficavam sem foto.
    // O objeto é imutável (a chave carrega o hash da origem), então guardar
    // é seguro.
    const cached = MediaMirrorService.objectCache.get(key);
    if (cached) {
      // Recoloca no fim: mantém o que está em uso e descarta o esquecido.
      MediaMirrorService.objectCache.delete(key);
      MediaMirrorService.objectCache.set(key, cached);
      return cached;
    }

    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      const objeto = {
        body: Buffer.concat(chunks),
        contentType: result.ContentType ?? 'application/octet-stream',
      };

      MediaMirrorService.objectCache.set(key, objeto);
      // Descarta o mais antigo quando estoura o teto (LRU simples).
      while (MediaMirrorService.objectCache.size > OBJECT_CACHE_MAX) {
        const maisAntigo = MediaMirrorService.objectCache.keys().next().value;
        if (maisAntigo === undefined) break;
        MediaMirrorService.objectCache.delete(maisAntigo);
      }
      return objeto;
    } catch (error) {
      this.logger.warn(`Leitura do S3 falhou (${key}): ${error}`);
      return null;
    }
  }

  /**
   * URL https assinada e TEMPORÁRIA de um objeto do bucket privado.
   *
   * Existe para entregar um objeto a uma FORNECEDORA (a API da Higgsfield só
   * busca frame por URL pública), sem abrir o bucket nem exigir
   * AWS_S3_PUBLIC_BASE. A validade é curta de propósito: a fornecedora baixa
   * o frame na hora do submit, e depois disso a URL não serve para nada.
   */
  async presignedUrl(key: string, expiresInSeconds = 3600): Promise<string | null> {
    if (!this.client || !key) return null;
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    } catch (error) {
      this.logger.warn(`Pré-assinatura falhou (${key}): ${error}`);
      return null;
    }
  }

  /**
   * Apaga um objeto do bucket.
   *
   * Devolve `false` em vez de estourar: quem chama está removendo um registro,
   * e um objeto órfão no S3 é bem menos grave do que uma linha que o usuário
   * mandou apagar continuar aparecendo na tela.
   */
  async deleteObject(key: string): Promise<boolean> {
    if (!this.client || !key) return false;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      // O cache guarda o corpo por chave: sem isto, um `readObject` seguinte
      // ainda serviria o vídeo apagado.
      MediaMirrorService.objectCache.delete(key);
      return true;
    } catch (error) {
      this.logger.warn(`Remoção no S3 falhou (${key}): ${error}`);
      return false;
    }
  }

  /** Espelha em lote, preservando a ordem. Falhas viram `null`. */
  async mirrorMany(
    urls: Array<string | null>,
    prefix: string,
    id: string,
  ): Promise<Array<string | null>> {
    const out: Array<string | null> = [];
    for (const url of urls) out.push(await this.mirror(url, prefix, id));
    return out;
  }

  private extensionOf(url: string): string {
    const match = /\.(jpe?g|png|webp|gif|mp4|webm)$/i.exec(url);
    return match ? `.${match[1].toLowerCase()}` : '';
  }
}
