import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

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
      const response = await fetch(sourceUrl, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
        redirect: 'follow',
      });
      if (!response.ok) {
        this.logger.warn(`Espelhamento: origem respondeu ${response.status}`);
        return null;
      }

      const contentType =
        response.headers.get('content-type') ?? 'application/octet-stream';
      if (!/^(image|video)\//.test(contentType)) {
        this.logger.warn(`Espelhamento: tipo inesperado "${contentType}"`);
        return null;
      }

      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > this.maxBytes) {
        this.logger.warn(`Espelhamento: arquivo grande demais (${body.byteLength}b)`);
        return null;
      }

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Imutável: a chave já contém o hash da origem.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${this.publicBase}/${key}`;
    } catch (error) {
      this.logger.warn(`Espelhamento falhou (${prefix}/${id}): ${error}`);
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
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return {
        body: Buffer.concat(chunks),
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      this.logger.warn(`Leitura do S3 falhou (${key}): ${error}`);
      return null;
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
