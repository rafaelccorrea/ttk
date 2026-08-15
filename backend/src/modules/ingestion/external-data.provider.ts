import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Produto vindo de um fornecedor pago de dados (EchoTik). Diferente do Creative
 * Center, esses serviços entregam VENDAS e RECEITA reais por produto — dado que
 * o TikTok não expõe publicamente.
 *
 * ATENÇÃO À MOEDA: o EchoTik devolve os campos de topo (`spu_avg_price`,
 * `total_sale_gmv_amt`) em USD, mesmo com `region=BR`. O preço em BRL só existe
 * dentro de `skus[].real_price`. Por isso derivamos o câmbio do próprio produto
 * (preço BRL ÷ preço USD) e aplicamos ao GMV — assim a receita fica em BRL sem
 * depender de cotação externa.
 */
export interface ExternalProduct {
  externalId: string;
  /** ID do produto na TikTok Shop — a chave real, sem prefixo. */
  tiktokProductId: string;
  title: string;
  category: string;
  /** Preço unitário em BRL (de `skus[].real_price`, ou convertido). */
  price: number;
  /** Preço unitário em USD, como veio do fornecedor. */
  priceUsd: number;
  imageUrl: string | null;
  /** Todas as imagens de capa, já ordenadas. */
  images: string[];
  storeName: string | null;
  /** ID do vendedor na TikTok Shop. Obrigatório para o produto ser aceito. */
  sellerId: string;
  /** Vendas do dia (número real do fornecedor). */
  salesDaily: number;
  /** Receita do dia em BRL. */
  revenueDaily: number;
  /** Vendas acumuladas. */
  salesTotal: number;
  /** Receita acumulada em BRL. */
  revenueTotal: number;
  /** Vendas nos últimos 7 dias. */
  sales7d: number;
  /** Nº de vídeos que venderam este produto. */
  videoCount: number;
  /** Nº de criadores que venderam este produto. */
  creatorCount: number;
  rating: number | null;
  reviewCount: number;
  region: string;
  tiktokUrl: string | null;
  /** Procedência do registro — para auditar quando o dado furar. */
  dataSource: string;
  fetchedAt: string;
}

/** Vídeo que efetivamente vendeu um produto. */
export interface ExternalVideo {
  videoId: string;
  productId: string;
  userId: string;
  caption: string;
  hashtags: string[];
  durationSec: number;
  coverUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** Unidades vendidas atribuídas a este vídeo. */
  salesCount: number;
  /** Receita atribuída a este vídeo (USD, como vem do fornecedor). */
  salesGmvUsd: number;
  createdAt: string;
  region: string;
}

/** URLs de mídia resolvidas na hora — nunca persistir, expiram em horas. */
export interface ResolvedMedia {
  videoId: string;
  playUrl: string;
  coverUrl: string | null;
  dynamicCoverUrl: string | null;
  /** URL canônica do post (@handle/video/id) — esta sim é estável. */
  homeUrl: string | null;
}

interface EchoTikEnvelope<T> {
  code: number;
  message?: string;
  data: T | null;
}

const DEFAULT_BASE_URL = 'https://open.echotik.live/api/v3';
/** Limite rígido do fornecedor: a API recusa page_size > 10. */
const MAX_PAGE_SIZE = 10;

/**
 * Conector do EchoTik.
 *
 *   ECHOTIK_APP_ID=...
 *   ECHOTIK_APP_SECRET=...
 *   ECHOTIK_REGION=BR                (default)
 *   ECHOTIK_BASE_URL=https://open.echotik.live/api/v3
 *
 * Compatível com a configuração genérica antiga (EXTERNAL_DATA_API_KEY já em
 * base64), para não quebrar ambientes existentes.
 */
@Injectable()
export class ExternalDataProvider {
  private readonly logger = new Logger(ExternalDataProvider.name);
  private readonly baseUrl: string;
  private readonly region: string;
  private readonly authValue: string;
  /** Contador de chamadas — a cota do EchoTik é por request, não por item. */
  private requestCount = 0;

  constructor(config: ConfigService) {
    this.baseUrl = (
      config.get<string>('ECHOTIK_BASE_URL') ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.region = config.get<string>('ECHOTIK_REGION') ?? 'BR';

    const appId = config.get<string>('ECHOTIK_APP_ID') ?? '';
    const secret = config.get<string>('ECHOTIK_APP_SECRET') ?? '';
    if (appId && secret) {
      this.authValue = `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`;
    } else {
      // Retrocompatibilidade: chave já pronta em base64.
      const legacy = config.get<string>('EXTERNAL_DATA_API_KEY') ?? '';
      const prefix = config.get<string>('EXTERNAL_DATA_AUTH_PREFIX') ?? 'Basic';
      this.authValue = legacy ? `${prefix} ${legacy}`.trim() : '';
    }
  }

  get enabled(): boolean {
    return this.authValue.length > 0;
  }

  /** Quantos requests já foram gastos nesta execução. */
  get requestsUsed(): number {
    return this.requestCount;
  }

  // ---------------------------------------------------------------- produtos

  /**
   * Top produtos da região, ordenados por GMV. `limit` é arredondado para cima
   * em páginas de 10 — cada página custa 1 request da cota.
   */
  async fetchTopProducts(limit = 50): Promise<ExternalProduct[]> {
    if (!this.enabled) {
      this.logger.warn('EchoTik não configurado (ECHOTIK_APP_ID/SECRET).');
      return [];
    }

    const pages = Math.ceil(limit / MAX_PAGE_SIZE);
    const out: ExternalProduct[] = [];
    const fetchedAt = new Date().toISOString();

    for (let page = 1; page <= pages; page += 1) {
      const rows = await this.get<Array<Record<string, unknown>>>(
        '/echotik/product/list',
        {
          region: this.region,
          page_num: page,
          page_size: MAX_PAGE_SIZE,
          sort_type: 1,
        },
      );
      if (!rows?.length) break;

      for (const row of rows) {
        const parsed = this.parseProduct(row, fetchedAt);
        if (parsed) out.push(parsed);
      }
      // Página incompleta significa fim da lista: não gasta request à toa.
      if (rows.length < MAX_PAGE_SIZE) break;
    }

    return out.slice(0, limit);
  }

  /** Vídeos que venderam um produto, do mais relevante para o menos. */
  async fetchProductVideos(
    tiktokProductId: string,
    limit = 10,
  ): Promise<ExternalVideo[]> {
    if (!this.enabled) return [];
    const rows = await this.get<Array<Record<string, unknown>>>(
      '/echotik/product/video/list',
      {
        region: this.region,
        product_id: tiktokProductId,
        page_num: 1,
        page_size: Math.min(limit, MAX_PAGE_SIZE),
      },
    );
    return (rows ?? []).map((row) => this.parseVideo(row));
  }

  /** Criadores que venderam um produto. */
  async fetchProductCreators(
    tiktokProductId: string,
    limit = 10,
  ): Promise<Array<Record<string, unknown>>> {
    if (!this.enabled) return [];
    const rows = await this.get<Array<Record<string, unknown>>>(
      '/echotik/product/influencer/list',
      {
        product_id: tiktokProductId,
        page_num: 1,
        page_size: Math.min(limit, MAX_PAGE_SIZE),
        // 4 = ordenar por GMV do produto; 1 = decrescente.
        product_influencer_sort_field: 4,
        sort_type: 1,
      },
    );
    return rows ?? [];
  }

  // ------------------------------------------------------------------ mídia

  /**
   * Resolve a URL tocável de um vídeo NO MOMENTO DO USO.
   *
   * O `play_addr` que vem na listagem é uma URL assinada do CDN da TikTok e já
   * chega expirada (responde 403) — foi a causa dos vídeos que não tocavam.
   * Nunca persista o resultado desta função: chame-a na hora de exibir, ou
   * espelhe o MP4 no S3 logo após resolver.
   */
  async resolveMedia(videoId: string): Promise<ResolvedMedia | null> {
    if (!this.enabled) return null;
    const data = await this.get<Record<string, unknown>>(
      '/realtime/video/download-url',
      { url: `https://www.tiktok.com/@tiktok/video/${videoId}` },
    );
    const playUrl = this.str(data?.play_url);
    if (!data || !playUrl) return null;
    return {
      videoId: this.str(data.video_id) ?? videoId,
      playUrl,
      coverUrl: this.str(data.cover_url),
      dynamicCoverUrl: this.str(data.dynamic_cover_url),
      homeUrl: this.str(data.home_url),
    };
  }

  // ------------------------------------------------------------------ HTTP

  private async get<T>(
    path: string,
    params: Record<string, string | number>,
  ): Promise<T | null> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    try {
      this.requestCount += 1;
      const response = await fetch(url, {
        headers: { accept: 'application/json', Authorization: this.authValue },
      });
      if (!response.ok) {
        this.logger.warn(`EchoTik ${path} respondeu HTTP ${response.status}`);
        return null;
      }
      const body = (await response.json()) as EchoTikEnvelope<T>;
      if (body.code !== 0) {
        this.logger.warn(
          `EchoTik ${path} retornou code=${body.code} (${body.message ?? 'sem mensagem'})`,
        );
        return null;
      }
      return body.data;
    } catch (error) {
      this.logger.warn(`EchoTik ${path} falhou: ${error}`);
      return null;
    }
  }

  // --------------------------------------------------------------- parsing

  private parseProduct(
    row: Record<string, unknown>,
    fetchedAt: string,
  ): ExternalProduct | null {
    const productId = this.str(row.product_id);
    const title = this.str(row.product_name)?.replace(/\s+/g, ' ').trim();
    const sellerId = this.str(row.seller_id);
    if (!productId || !title || !sellerId) return null;

    const priceUsd = this.num(row.spu_avg_price);
    const brl = this.extractBrlPrice(row.skus);
    // Câmbio derivado do próprio produto — mais confiável que cotação chutada.
    const fxRate = brl && priceUsd > 0 ? brl / priceUsd : null;
    const toBrl = (usd: number) => (fxRate ? Number((usd * fxRate).toFixed(2)) : usd);

    const images = this.extractCovers(row.cover_url);

    return {
      externalId: `echotik-${productId}`,
      tiktokProductId: productId,
      title,
      category: this.str(row.category_id) ?? 'geral',
      price: brl ?? priceUsd,
      priceUsd,
      imageUrl: images[0] ?? null,
      images,
      // O endpoint de produto não traz o nome da loja, só o id.
      storeName: this.str(row.seller_name),
      sellerId,
      salesDaily: this.num(row.total_sale_1d_cnt),
      revenueDaily: toBrl(this.num(row.total_sale_gmv_1d_amt)),
      salesTotal: this.num(row.total_sale_cnt),
      revenueTotal: toBrl(this.num(row.total_sale_gmv_amt)),
      sales7d: this.num(row.total_sale_7d_cnt),
      videoCount: this.num(row.total_video_cnt),
      creatorCount: this.num(row.total_ifl_cnt),
      rating: row.product_rating == null ? null : this.num(row.product_rating),
      reviewCount: this.num(row.review_count),
      region: this.str(row.region) ?? this.region,
      tiktokUrl: `https://shop.tiktok.com/view/product/${productId}`,
      dataSource: 'echotik',
      fetchedAt,
    };
  }

  private parseVideo(row: Record<string, unknown>): ExternalVideo {
    const desc = this.str(row.video_desc) ?? '';
    const tags = this.str(row.hash_tag) ?? '';
    const createTime = this.num(row.create_time);
    return {
      videoId: this.str(row.video_id) ?? '',
      productId: this.str(row.product_id) ?? '',
      userId: this.str(row.user_id) ?? '',
      caption: desc,
      hashtags: tags.match(/#[^\s#]+/g) ?? [],
      durationSec: this.num(row.duration),
      coverUrl: this.str(row.reflow_cover),
      views: this.num(row.total_views_cnt),
      likes: this.num(row.total_digg_cnt),
      comments: this.num(row.total_comments_cnt),
      shares: this.num(row.total_shares_cnt),
      salesCount: this.num(row.total_video_sale_cnt),
      salesGmvUsd: this.num(row.total_video_sale_gmv_amt),
      // create_time vem em segundos.
      createdAt: createTime
        ? new Date(createTime * 1000).toISOString()
        : new Date().toISOString(),
      region: this.str(row.region) ?? this.region,
    };
    // Nota: `play_addr` existe no payload mas é ignorado de propósito — vem
    // com assinatura expirada. Use resolveMedia(videoId) na hora de exibir.
  }

  /**
   * `cover_url` chega como STRING contendo um array JSON de {url, index}.
   * Devolve as URLs ordenadas por index.
   */
  private extractCovers(raw: unknown): string[] {
    const text = this.str(raw);
    if (!text) return [];
    if (text.startsWith('http')) return [text];
    try {
      const parsed = JSON.parse(text) as Array<{ url?: string; index?: number }>;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((item) => item.url)
        .filter((url): url is string => typeof url === 'string');
    } catch {
      return [];
    }
  }

  /**
   * O preço em BRL só existe dentro de `skus[].real_price`. Pega o menor preço
   * entre os SKUs em BRL — é o que o comprador vê como "a partir de".
   */
  private extractBrlPrice(raw: unknown): number | null {
    const text = this.str(raw);
    if (!text) return null;
    try {
      const skus = JSON.parse(text) as Array<{
        real_price?: { currency_name?: string; sale_price_decimal?: string };
      }>;
      if (!Array.isArray(skus)) return null;
      const prices = skus
        .map((sku) => sku.real_price)
        .filter((p) => p?.currency_name === 'BRL')
        .map((p) => Number(p?.sale_price_decimal))
        .filter((n) => Number.isFinite(n) && n > 0);
      return prices.length ? Math.min(...prices) : null;
    } catch {
      return null;
    }
  }

  private str(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text.length ? text : null;
  }

  private num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
}
