import { Injectable, Logger } from '@nestjs/common';

/**
 * oEmbed público do TikTok — fonte GRATUITA de metadados de vídeo.
 *
 * POR QUE EXISTE
 * --------------
 * O fornecedor pago (EchoTik) entrega a lista de vídeos que venderam um
 * produto, mas com duas lacunas caras:
 *
 *  1. Não devolve o @handle do autor, só o `user_id` numérico. Sem handle não
 *     há URL do post, e a coluna `videos.videoUrl` fica nula — o card perde o
 *     link "abrir no TikTok".
 *  2. A capa (`reflow_cover`) vive num CDN com proteção de hotlink: sem
 *     assinar, responde 403 e o card aparece PRETO.
 *
 * Preencher essas duas lacunas pela API paga custa caro: ~1 request de
 * `influencer/detail` por 10 autores, mais ~1 de `batch/cover/download` por 10
 * imagens. Numa execução com 125 produtos isso passa de 30 requests só para
 * ter nome e foto.
 *
 * O oEmbed do TikTok resolve os dois de graça, sem autenticação e sem cota:
 *
 *   GET https://www.tiktok.com/oembed?url=https://www.tiktok.com/@x/video/<id>
 *
 * Detalhe importante: o @handle na URL de consulta é IGNORADO pelo TikTok — a
 * resolução é pelo id numérico. Por isso funciona mesmo quando ainda não
 * sabemos quem é o autor, que é justamente o nosso caso.
 *
 * Retorna `author_unique_id` (o handle real) e `thumbnail_url` (que carrega
 * direto, sem assinatura). Medido: HTTP 206 `image/jpeg`.
 *
 * LIMITES
 * -------
 * - Vídeo removido, privado ou com conta banida responde erro: ~28% de falha
 *   na nossa primeira passada (17 de 60). É esperado, não é bug.
 * - É endpoint público sem contrato de SLA. Serve como COMPLEMENTO do dado
 *   pago, nunca como fonte de verdade de vendas.
 * - Sem limite documentado, mas espaçamos as chamadas para não abusar.
 */

export interface OembedVideo {
  /** @handle real do autor, sem "@". */
  handle: string;
  /** URL canônica do post, montada a partir do handle. */
  videoUrl: string;
  /** Capa que carrega sem assinatura. */
  thumbnailUrl: string | null;
  /** Legenda do post. */
  title: string | null;
}

@Injectable()
export class TikTokOembedSource {
  private readonly logger = new Logger(TikTokOembedSource.name);
  /** Pausa entre chamadas — é serviço público, não convém martelar. */
  private readonly delayMs = 120;

  /** Busca os metadados de um vídeo pelo id numérico. */
  async fetchVideo(videoId: string): Promise<OembedVideo | null> {
    if (!/^\d+$/.test(videoId)) return null;

    try {
      // O handle aqui é irrelevante: o TikTok resolve pelo id.
      const target = `https://www.tiktok.com/@x/video/${videoId}`;
      const response = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`,
      );
      if (!response.ok) return null;

      const body = (await response.json()) as Record<string, unknown>;
      const handle =
        (body.author_unique_id as string) ??
        String(body.author_url ?? '').split('@')[1];
      if (!handle) return null;

      return {
        handle,
        videoUrl: `https://www.tiktok.com/@${handle}/video/${videoId}`,
        thumbnailUrl: (body.thumbnail_url as string) ?? null,
        title: (body.title as string) ?? null,
      };
    } catch (error) {
      this.logger.debug(`oEmbed falhou para ${videoId}: ${error}`);
      return null;
    }
  }

  /**
   * Versão em lote, sequencial e espaçada. Vídeos indisponíveis simplesmente
   * não aparecem no resultado.
   */
  async fetchMany(videoIds: string[]): Promise<Map<string, OembedVideo>> {
    const out = new Map<string, OembedVideo>();
    for (const id of [...new Set(videoIds)]) {
      const data = await this.fetchVideo(id);
      if (data) out.set(id, data);
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return out;
  }
}
