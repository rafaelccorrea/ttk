import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { categoryName } from './product-categories';

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
  /** Nome da categoria em português, pronto para o filtro da interface. */
  category: string;
  /** Id numérico da categoria na TikTok Shop. */
  categoryId: string;
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

/** Criador que efetivamente vendeu um produto. */
export interface ExternalCreator {
  userId: string;
  /** Nome de exibição. O endpoint NÃO devolve o @handle. */
  nickName: string;
  avatarUrl: string | null;
  category: string | null;
  followers: number;
  likes: number;
  totalVideos: number;
  totalViews: number;
  /** Vendas deste criador para ESTE produto. */
  productSales: number;
  /** GMV deste criador para ESTE produto (USD, como vem do fornecedor). */
  productGmvUsd: number;
  productId: string;
  region: string;
}

/**
 * Enriquecimento vindo de `/influencer/detail` (lote de até 10 ids por
 * request). É a ÚNICA forma barata de descobrir o @handle: a lista de
 * criadores por produto devolve só `user_id` e o nome de exibição.
 */
export interface ExternalCreatorDetail {
  userId: string;
  /** @handle real, sem "@". */
  handle: string;
  nickName: string;
  avatarUrl: string | null;
  category: string | null;
  language: string | null;
  followers: number;
  totalSales: number;
  totalGmvUsd: number;
}

/** URLs de mídia resolvidas na hora — nunca persistir, expiram em horas. */
export interface ResolvedMedia {
  videoId: string;
  /**
   * Melhor fonte disponível, nesta ordem: sem marca d'água > download > play.
   * O `play_url` é o stream de preview e vem com bitrate de áudio bem baixo;
   * os de download são o arquivo completo.
   */
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
/** A URL assinada do CDN dura poucas horas; renovamos com folga. */
const MEDIA_TTL_MS = 90 * 60 * 1000;
const MEDIA_CACHE_MAX = 2000;
/** `product_sort_field`: 7 = total_sale_gmv_30d_amt. */
const PRODUCT_SORT_GMV_30D = 7;
/** Quanto tempo parar de chamar o fornecedor depois de bater no limite. */
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
/** Só URLs deste host podem (e precisam) ser assinadas. */
const SIGNABLE_HOST = 'echosell-images.tos-ap-southeast-1.volces.com';

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
  /** Piso de vendas em 30 dias para o produto sequer entrar na página. */
  private readonly minSales30d: number;
  private readonly authValue: string;
  /** Contador de chamadas — a cota do EchoTik é por request, não por item. */
  private requestCount = 0;
  /** Teto de requests da execução atual. 0 = esgotado, Infinity = sem teto. */
  private budget = Number.POSITIVE_INFINITY;
  private readonly mediaCache = new Map<
    string,
    { media: ResolvedMedia; expiresAt: number }
  >();
  /**
   * Disjuntor de cota.
   *
   * Quando a conta fica sem saldo, o fornecedor leva ~7 SEGUNDOS para
   * responder o erro. Sem isso, cada play na interface pagava esse pedágio
   * antes de cair no embed — o que fazia o player parecer travado. Ao ver o
   * primeiro "Usage Limit Exceeded", paramos de chamar por um tempo.
   */
  private quotaBlockedUntil = 0;

  constructor(config: ConfigService) {
    this.baseUrl = (
      config.get<string>('ECHOTIK_BASE_URL') ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.region = config.get<string>('ECHOTIK_REGION') ?? 'BR';
    this.minSales30d = Number(config.get<string>('ECHOTIK_MIN_SALES_30D') ?? 50);

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

  get budgetExhausted(): boolean {
    return this.requestCount >= this.budget;
  }

  /**
   * Abre uma execução com teto de requests. O contrato da cota do EchoTik é
   * mensal e não recupera: melhor uma ingestão parcial hoje do que estourar a
   * cota no dia 10 e ficar sem dado até o fim do mês.
   */
  beginRun(maxRequests: number): void {
    this.requestCount = 0;
    this.budget = maxRequests > 0 ? maxRequests : 0;
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
          // SEM este campo a API devolve ordem arbitrária — era o motivo do
          // catálogo vir com item aleatório em vez de campeão de venda.
          // 7 = GMV dos últimos 30 dias: "o que está vendendo agora".
          product_sort_field: PRODUCT_SORT_GMV_30D,
          sort_type: 1,
          // Corta a cauda longa antes de gastar página com quem não vende.
          min_total_sale_30d_cnt: this.minSales30d,
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

  /**
   * Top produtos de UMA categoria.
   *
   * A lista global concentra em Beleza e Eletrônicos; varrer categoria a
   * categoria é o que dá cobertura real de nicho (Pet Shop, Automotivo,
   * Moda Infantil) por poucas páginas cada.
   */
  async fetchProductsByCategory(
    categoryId: string,
    pages = 3,
  ): Promise<ExternalProduct[]> {
    if (!this.enabled) return [];
    const out: ExternalProduct[] = [];
    const fetchedAt = new Date().toISOString();

    for (let page = 1; page <= pages; page += 1) {
      const rows = await this.get<Array<Record<string, unknown>>>(
        '/echotik/product/list',
        {
          region: this.region,
          category_id: categoryId,
          page_num: page,
          page_size: MAX_PAGE_SIZE,
          product_sort_field: PRODUCT_SORT_GMV_30D,
          sort_type: 1,
          min_total_sale_30d_cnt: this.minSales30d,
        },
      );
      if (!rows?.length) break;
      for (const row of rows) {
        const parsed = this.parseProduct(row, fetchedAt);
        if (parsed) out.push(parsed);
      }
      if (rows.length < MAX_PAGE_SIZE) break;
    }
    return out;
  }

  /**
   * Atualiza métricas de produtos JÁ conhecidos, em lote de 10 por request.
   *
   * É a camada mais importante da estratégia de cota: manter 2.500 produtos
   * atualizados custa 250 requests, não 2.500.
   */
  async fetchProductDetails(
    tiktokProductIds: string[],
  ): Promise<Map<string, ExternalProduct>> {
    const out = new Map<string, ExternalProduct>();
    if (!this.enabled) return out;

    const unique = [...new Set(tiktokProductIds.filter(Boolean))];
    const fetchedAt = new Date().toISOString();

    for (let i = 0; i < unique.length; i += MAX_PAGE_SIZE) {
      const chunk = unique.slice(i, i + MAX_PAGE_SIZE);
      const rows = await this.get<Array<Record<string, unknown>>>(
        '/echotik/product/detail',
        { product_ids: chunk.join(',') },
      );
      // `null` aqui significa cota esgotada ou erro: parar em vez de insistir.
      if (!rows) break;
      for (const row of rows) {
        const parsed = this.parseProduct(row, fetchedAt);
        if (parsed) out.set(parsed.tiktokProductId, parsed);
      }
    }
    return out;
  }

  /**
   * Série diária real de um produto (até 180 dias no fornecedor).
   *
   * Usada para preencher o histórico de um produto recém-descoberto: sem isso
   * o ranking por período fica zerado até acumularmos dias, e inventar número
   * não é opção.
   */
  async fetchProductTrend(
    tiktokProductId: string,
    days = 30,
  ): Promise<Array<{ date: string; sales: number; gmvUsd: number }>> {
    if (!this.enabled) return [];

    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const out: Array<{ date: string; sales: number; gmvUsd: number }> = [];
    // page_size é 10, então 30 dias custam 3 requests.
    const pages = Math.ceil(days / MAX_PAGE_SIZE);

    for (let page = 1; page <= pages; page += 1) {
      const rows = await this.get<Array<Record<string, unknown>>>(
        '/echotik/product/trend',
        {
          product_id: tiktokProductId,
          start_date: iso(start),
          end_date: iso(end),
          page_num: page,
          page_size: MAX_PAGE_SIZE,
        },
      );
      if (!rows?.length) break;
      for (const row of rows) {
        const date = this.str(row.dt);
        if (!date) continue;
        out.push({
          date: date.slice(0, 10),
          sales: this.num(row.total_sale_cnt),
          gmvUsd: this.num(row.total_sale_gmv_amt),
        });
      }
      if (rows.length < MAX_PAGE_SIZE) break;
    }
    return out;
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

  /** Criadores que venderam um produto, do maior GMV para o menor. */
  async fetchProductCreators(
    tiktokProductId: string,
    limit = 10,
  ): Promise<ExternalCreator[]> {
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
    return (rows ?? [])
      .map((row) => this.parseCreator(row, tiktokProductId))
      .filter((c): c is ExternalCreator => c !== null);
  }

  /**
   * Enriquece criadores em LOTE (até 10 ids por request). Sem isto não há
   * @handle — e sem @handle não dá para linkar o perfil nem para usar a coluna
   * única de `creators`.
   */
  async fetchCreatorDetails(
    userIds: string[],
  ): Promise<Map<string, ExternalCreatorDetail>> {
    const out = new Map<string, ExternalCreatorDetail>();
    if (!this.enabled) return out;

    const unique = [...new Set(userIds.filter(Boolean))];
    for (let i = 0; i < unique.length; i += MAX_PAGE_SIZE) {
      const chunk = unique.slice(i, i + MAX_PAGE_SIZE);
      const rows = await this.get<Array<Record<string, unknown>>>(
        '/echotik/influencer/detail',
        { user_ids: chunk.join(',') },
      );
      if (!rows) break;
      for (const row of rows) {
        const userId = this.str(row.user_id);
        const handle = this.str(row.unique_id);
        if (!userId || !handle) continue;
        out.set(userId, {
          userId,
          handle,
          nickName: this.str(row.nick_name) ?? handle,
          avatarUrl: this.str(row.avatar),
          category: this.str(row.category),
          language: this.str(row.language),
          followers: this.num(row.total_followers_cnt),
          totalSales: this.num(row.total_sale_cnt),
          totalGmvUsd: this.num(row.total_sale_gmv_amt),
        });
      }
    }
    return out;
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
    if (!this.enabled || !videoId) return null;

    // Cache: sem ele, cada play na interface vira 1 request e a cota mensal
    // acaba em dias. O TTL fica abaixo da validade da assinatura do CDN.
    const cached = this.mediaCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached.media;

    const data = await this.get<Record<string, unknown>>(
      '/realtime/video/download-url',
      { url: `https://www.tiktok.com/@tiktok/video/${videoId}` },
    );
    const playUrl =
      this.str(data?.no_watermark_download_url) ??
      this.str(data?.download_url) ??
      this.str(data?.play_url);
    if (!data || !playUrl) return null;

    const media: ResolvedMedia = {
      videoId: this.str(data.video_id) ?? videoId,
      playUrl,
      coverUrl: this.str(data.cover_url),
      dynamicCoverUrl: this.str(data.dynamic_cover_url),
      homeUrl: this.str(data.home_url),
    };
    this.mediaCache.set(videoId, {
      media,
      expiresAt: Date.now() + MEDIA_TTL_MS,
    });
    this.pruneMediaCache();
    return media;
  }

  /**
   * Assina URLs de imagem do CDN do EchoTik.
   *
   * As URLs cruas do domínio `echosell-images...volces.com` respondem 403 por
   * proteção de hotlink — era por isso que produto, vídeo e criador apareciam
   * sem imagem. Este endpoint devolve a mesma URL assinada, válida por ~3 dias,
   * em lotes de 10.
   *
   * ATENÇÃO: a documentação afirma "does not consume call counts", mas MEDIMOS
   * o contrário — o painel cobrou 1 request por lote. Por isso conta na cota.
   * Consequência prática: assinar galeria inteira é caro (8 fotos por produto
   * = quase 1 request por produto). Assine só o que a tela vai exibir, e
   * espelhe no S3 para não pagar de novo a cada execução.
   */
  async signImageUrls(urls: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.enabled) return out;

    const pending = [...new Set(urls.filter((u) => u?.includes(SIGNABLE_HOST)))];
    for (let i = 0; i < pending.length; i += MAX_PAGE_SIZE) {
      const chunk = pending.slice(i, i + MAX_PAGE_SIZE);
      // A resposta é um ARRAY de objetos de uma chave só: [{origem: assinada}].
      const rows = await this.get<Array<Record<string, string>>>(
        '/echotik/batch/cover/download',
        { cover_urls: chunk.join(',') },
      );
      if (!rows) continue;
      for (const row of rows) {
        for (const [source, signed] of Object.entries(row ?? {})) {
          if (signed) out.set(source, signed);
        }
      }
    }
    return out;
  }

  /** Evita crescimento indefinido do cache em processo longo. */
  private pruneMediaCache(): void {
    if (this.mediaCache.size <= MEDIA_CACHE_MAX) return;
    const now = Date.now();
    for (const [key, entry] of this.mediaCache) {
      if (entry.expiresAt <= now) this.mediaCache.delete(key);
    }
    // Ainda grande depois de limpar os expirados: descarta os mais antigos.
    while (this.mediaCache.size > MEDIA_CACHE_MAX) {
      const oldest = this.mediaCache.keys().next().value;
      if (oldest === undefined) break;
      this.mediaCache.delete(oldest);
    }
  }

  // ------------------------------------------------------------------ HTTP

  private async get<T>(
    path: string,
    params: Record<string, string | number>,
    /** `false` para endpoints que o fornecedor não cobra (download de capa). */
    countsAgainstQuota = true,
  ): Promise<T | null> {
    // Cota esgotada há pouco: nem tenta. Economiza os ~7s do erro.
    if (Date.now() < this.quotaBlockedUntil) return null;

    if (countsAgainstQuota && this.budgetExhausted) {
      this.logger.warn(
        `Cota da execução esgotada (${this.requestCount}); ${path} não foi chamado.`,
      );
      return null;
    }

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    try {
      if (countsAgainstQuota) this.requestCount += 1;
      const response = await fetch(url, {
        headers: { accept: 'application/json', Authorization: this.authValue },
      });
      // O corpo é lido MESMO em erro HTTP: o EchoTik devolve o aviso de cota
      // dentro de um 500 com JSON. Sair antes de ler impedia o disjuntor de
      // armar, e cada play voltava a pagar ~7s esperando o mesmo erro.
      let body: EchoTikEnvelope<T> | null = null;
      try {
        body = (await response.json()) as EchoTikEnvelope<T>;
      } catch {
        body = null;
      }

      if (!body) {
        this.logger.warn(`EchoTik ${path} respondeu HTTP ${response.status}`);
        return null;
      }
      if (!response.ok || body.code !== 0) {
        if (/usage limit/i.test(body.message ?? '')) {
          this.quotaBlockedUntil = Date.now() + QUOTA_COOLDOWN_MS;
          this.logger.warn(
            `Cota do EchoTik esgotada — chamadas suspensas por ${QUOTA_COOLDOWN_MS / 60000} min.`,
          );
        } else {
          this.logger.warn(
            `EchoTik ${path} retornou code=${body.code} (${body.message ?? 'sem mensagem'})`,
          );
        }
        return null;
      }
      // Deu certo: a cota voltou, reabre o disjuntor.
      this.quotaBlockedUntil = 0;
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
      // Nome legível em PT: o id cru ("601739") não serve para filtrar na UI.
      category: categoryName(this.str(row.category_id)),
      categoryId: this.str(row.category_id) ?? '0',
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

  private parseCreator(
    row: Record<string, unknown>,
    productId: string,
  ): ExternalCreator | null {
    const userId = this.str(row.user_id);
    if (!userId) return null;
    return {
      userId,
      nickName: this.str(row.nick_name) ?? userId,
      avatarUrl: this.str(row.avatar),
      category: this.str(row.category),
      followers: this.num(row.total_followers_cnt),
      likes: this.num(row.total_digg_cnt),
      totalVideos: this.num(row.total_post_video_cnt),
      totalViews: this.num(row.total_views_cnt),
      productSales: this.num(row.per_product_ifl_sale_cnt),
      productGmvUsd: this.num(row.per_product_ifl_gmv_amt),
      productId,
      region: this.str(row.region) ?? this.region,
    };
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
