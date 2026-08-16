import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryProductsDto } from './dto/query-products.dto';
import { ProductFavorite } from './entities/product-favorite.entity';
import { ProductMetricDaily } from './entities/product-metric-daily.entity';
import { Product } from './entities/product.entity';

export interface RankedProduct {
  id: string;
  title: string;
  storeName: string | null;
  category: string;
  price: number;
  imageUrl: string | null;
  /** Galeria de fotos reais do produto (pode estar vazia). */
  images: string[];
  rating: number | null;
  radarScore: number | null;
  tiktokUrl: string | null;
  salesPeriod: number;
  revenuePeriod: number;
  growthPct: number | null;
  isFavorite?: boolean;
}

/** Validade do cache da vitrine — curto o bastante para não servir dado velho. */
const SECTIONS_TTL_MS = 60 * 1000;

@Injectable()
export class ProductsService {
  /**
   * Linhas brutas da vitrine, compartilhadas entre requisições do scroll.
   */
  private static readonly sectionsCache = new Map<
    string,
    { rows: any[]; expiresAt: number }
  >();

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(ProductMetricDaily)
    private readonly metrics: Repository<ProductMetricDaily>,
    @InjectRepository(ProductFavorite)
    private readonly favorites: Repository<ProductFavorite>,
  ) {}

  private isoDaysAgo(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Colunas de período do produto.
   *
   * O ranking somava `product_metrics_daily`, mas a ingestão só grava o dia
   * corrente — todo produto tinha 1 dia de dado e 7/30/90 devolviam o mesmo
   * resultado. Estas colunas vêm prontas do fornecedor e são reais.
   */
  private colunasDoPeriodo(period: number): {
    sales: string;
    revenue: string;
    /** Base de comparação para crescimento, ou null quando não existe. */
    salesAnterior: string | null;
  } {
    if (period <= 7) {
      // Não temos 14 dias para comparar; estimar aqui seria inventar número.
      return { sales: 'sales7d', revenue: 'revenue7d', salesAnterior: null };
    }
    if (period >= 90) {
      // Faltaria o acumulado de 180 dias para a janela anterior.
      return { sales: 'sales90d', revenue: 'revenue90d', salesAnterior: null };
    }
    // 30 dias: a janela anterior é o que sobra entre 60 e 30.
    return {
      sales: 'sales30d',
      revenue: 'revenue30d',
      salesAnterior: '(p."sales60d" - p."sales30d")',
    };
  }

  async rank(
    query: QueryProductsDto,
    userId?: string,
  ): Promise<{ items: RankedProduct[]; total: number; page: number }> {
    const period = query.period ?? 30;
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;
    const col = this.colunasDoPeriodo(period);

    const qb = this.products
      .createQueryBuilder('p')
      .select('p.id', 'id')
      .addSelect('p.title', 'title')
      .addSelect('p.storeName', 'storeName')
      .addSelect('p.category', 'category')
      .addSelect('p.price', 'price')
      .addSelect('p.imageUrl', 'imageUrl')
      .addSelect('p.images', 'images')
      .addSelect('p.rating', 'rating')
      .addSelect('p.radarScore', 'radarScore')
      .addSelect('p.tiktokUrl', 'tiktokUrl')
      .addSelect(`p."${col.sales}"`, 'salesPeriod')
      .addSelect(`p."${col.revenue}"`, 'revenuePeriod')
      .addSelect(
        col.salesAnterior ? `${col.salesAnterior}` : '0',
        'salesPrevious',
      );

    const favoriteIds = userId
      ? new Set(
          (await this.favorites.find({ where: { userId } })).map(
            (f) => f.productId,
          ),
        )
      : new Set<string>();

    // Filtros sobre colunas do produto (WHERE). Aplicados igualmente na
    // query principal e na de contagem, para o total bater com a lista.
    const applyWhere = (target: typeof qb) => {
      // Duplicado continua no banco (histórico de métricas), mas fora da lista:
      // senão a vitrine repete o mesmo produto anunciado por vários vendedores.
      target.andWhere('p."isDuplicate" = false');
      if (query.category) {
        target.andWhere('p.category = :category', { category: query.category });
      }
      if (query.store) {
        target.andWhere('p.storeName ILIKE :store', { store: `%${query.store}%` });
      }
      if (query.search) {
        target.andWhere('(p.title ILIKE :search OR p.storeName ILIKE :search)', {
          search: `%${query.search}%`,
        });
      }
      if (query.minPrice !== undefined) {
        target.andWhere('p.price >= :minPrice', { minPrice: query.minPrice });
      }
      if (query.maxPrice !== undefined) {
        target.andWhere('p.price <= :maxPrice', { maxPrice: query.maxPrice });
      }
      if (query.minRating !== undefined) {
        target.andWhere('p.rating >= :minRating', { minRating: query.minRating });
      }
      if (query.withImage) {
        target.andWhere('p.imageUrl IS NOT NULL');
      }
      if (query.onlyFavorites) {
        // Sem favoritos, força resultado vazio em vez de ignorar o filtro.
        if (favoriteIds.size === 0) {
          target.andWhere('1 = 0');
        } else {
          target.andWhere('p.id IN (:...favoriteIds)', {
            favoriteIds: [...favoriteIds],
          });
        }
      }
      return target;
    };

    // Filtros de período agora são WHERE simples: os números já estão na
    // linha do produto, não precisam de agregação.
    if (query.minSales !== undefined) {
      qb.andWhere(`p."${col.sales}" >= :minSales`, { minSales: query.minSales });
    }
    if (query.minRevenue !== undefined) {
      qb.andWhere(`p."${col.revenue}" >= :minRevenue`, {
        minRevenue: query.minRevenue,
      });
    }
    if (query.minGrowth !== undefined) {
      if (col.salesAnterior) {
        // Crescimento = (atual − anterior) / anterior.
        qb.andWhere(
          `${col.salesAnterior} > 0
           AND ((p."${col.sales}" - ${col.salesAnterior}) * 100.0
                / NULLIF(${col.salesAnterior}, 0)) >= :minGrowth`,
          { minGrowth: query.minGrowth },
        );
      } else {
        // Sem janela anterior para este período, o filtro não tem base —
        // devolver tudo seria enganoso.
        qb.andWhere('1 = 0');
      }
    }

    applyWhere(qb);

    const direction = query.order === 'asc' ? 'ASC' : 'DESC';
    const sortExpression = this.sortExpression(query.sort, col);
    // Desempate por id: sem ele, linhas empatadas trocam de posição entre
    // requisições (sort instável do Postgres) e podem duplicar/sumir na paginação.
    // NULLS LAST: produto sem base de comparação não tem crescimento, e o
    // Postgres jogaria esses nulos para o TOPO no DESC — o "maior
    // crescimento" apareceria vazio.
    qb.orderBy(sortExpression, direction, 'NULLS LAST').addOrderBy(
      'p.id',
      'ASC',
    );

 // Sem agregação, o total é uma contagem direta da mesma query — não
    // precisa mais materializar todas as linhas só para contá-las.
    const total = await qb.clone().getCount();

    const rows = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();

    const items = rows.map((r) => this.toRanked(r, favoriteIds));
    return { items, total, page };
  }

  /**
   * Opções para a barra de filtros. As faixas vêm do catálogo real, então os
   * controles nunca oferecem um intervalo que não existe em produto nenhum.
   */
  async filterOptions() {
    const [categories, stores, range] = await Promise.all([
      this.categories(),
      this.products
        .createQueryBuilder('p')
        .select('DISTINCT p.storeName', 'storeName')
        .where('p.storeName IS NOT NULL')
        .orderBy('p.storeName', 'ASC')
        .getRawMany<{ storeName: string }>(),
      this.products
        .createQueryBuilder('p')
        .select('MIN(p.price)', 'minPrice')
        .addSelect('MAX(p.price)', 'maxPrice')
        .getRawOne<{ minPrice: string; maxPrice: string }>(),
    ]);

    return {
      categories,
      stores: stores.map((s) => s.storeName),
      priceRange: {
        min: Math.floor(Number(range?.minPrice ?? 0)),
        max: Math.ceil(Number(range?.maxPrice ?? 0)),
      },
      sorts: [
        { value: 'sales', label: 'Mais vendidos' },
        { value: 'revenue', label: 'Maior receita' },
        { value: 'growth', label: 'Maior crescimento' },
        { value: 'radar', label: 'Radar PikPok' },
        { value: 'rating', label: 'Melhor avaliados' },
        { value: 'price', label: 'Preço' },
      ],
    };
  }

  /** Coluna/expressão de ordenação para cada opção de sort. */
  private sortExpression(
    sort: QueryProductsDto['sort'],
    col: { sales: string; revenue: string; salesAnterior: string | null },
  ): string {
    switch (sort) {
      case 'revenue':
        return `p."${col.revenue}"`;
      case 'price':
        return 'p.price';
      case 'rating':
        // Sem nota, o produto vai para o fim em vez de virar "melhor avaliado".
        return 'COALESCE(p.rating, 0)';
      case 'radar':
        return 'COALESCE(p."radarScore", 0)';
      case 'growth':
        // Sem janela anterior (7 e 90 dias), não há crescimento a ordenar:
        // cai para vendas em vez de fingir uma ordem que não existe.
        if (!col.salesAnterior) return `p."${col.sales}"`;
        return `CASE
          WHEN ${col.salesAnterior} <= 0 THEN NULL
          ELSE (p."${col.sales}" - ${col.salesAnterior}) * 100.0
               / ${col.salesAnterior}
        END`;
      default:
        return `p."${col.sales}"`;
    }
  }

  /**
   * Catálogo agrupado em seções por categoria, com os melhores de cada uma.
   *
   * Existe para a vitrine não virar uma grade misturada onde perfume divide
   * espaço com furadeira: o usuário varre por nicho. Tudo sai de UMA query,
   * com `ROW_NUMBER` particionado — buscar categoria a categoria seriam 29
   * idas ao banco por carregamento de tela.
   */
  async sections(
    period = 30,
    perSection = 12,
    maxSections = 10,
    userId?: string,
    /** Abaixo disso a categoria não vira seção — 2 produtos não são vitrine. */
    minItems = 4,
    /** Quantas seções pular — é o cursor do scroll infinito. */
    offsetSections = 0,
  ): Promise<{
    sections: Array<{
      category: string;
      total: number;
      items: RankedProduct[];
    }>;
    /** Há mais seções depois desta página — o scroll infinito usa isto. */
    hasMore: boolean;
  }> {
    const col = this.colunasDoPeriodo(period);

    // Mesma razão do lado dos vídeos: a janela do ROW_NUMBER varre a tabela
    // inteira (~0,7s) e o scroll infinito repete a chamada só mudando o
    // offset. Guardamos as linhas por pouco tempo; a marcação de favorito
    // continua sendo resolvida por usuário, fora do cache.
    const cacheKey = `sections:${period}:${perSection}`;
    const cached = ProductsService.sectionsCache.get(cacheKey);
    const rows: any[] = cached && cached.expiresAt > Date.now()
      ? cached.rows
      : await this.products.query(
      `
      WITH agg AS (
        SELECT p.id, p.title, p."storeName", p.category, p.price, p."imageUrl",
               p.images, p.rating, p."radarScore", p."tiktokUrl",
               -- Números reais do fornecedor, direto na linha do produto.
               -- Antes isto somava a série diária, que só tem o dia corrente:
               -- 7, 30 e 90 dias devolviam exatamente o mesmo resultado.
               p."${col.sales}"   AS "salesPeriod",
               p."${col.revenue}" AS "revenuePeriod",
               ${col.salesAnterior ? `${col.salesAnterior}` : '0'} AS "salesPrevious"
          FROM products p
         WHERE p."isDuplicate" = false
      ), ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY category ORDER BY "salesPeriod" DESC, id ASC
               ) AS rn,
               COUNT(*)  OVER (PARTITION BY category) AS "categoryTotal",
               SUM("salesPeriod") OVER (PARTITION BY category) AS "categorySales"
          FROM agg
      )
      SELECT * FROM ranked
       WHERE rn <= $1
       ORDER BY "categorySales" DESC, category ASC, rn ASC
      `,
      [perSection],
    );

    if (!cached || cached.expiresAt <= Date.now()) {
      ProductsService.sectionsCache.set(cacheKey, {
        rows,
        expiresAt: Date.now() + SECTIONS_TTL_MS,
      });
    }

    const favoriteIds = userId
      ? new Set(
          (await this.favorites.find({ where: { userId } })).map(
            (f) => f.productId,
          ),
        )
      : new Set<string>();

    // Preserva a ordem que o SQL já definiu (categoria de maior venda primeiro).
    const byCategory = new Map<
      string,
      { category: string; total: number; items: RankedProduct[] }
    >();
    for (const row of rows) {
      let section = byCategory.get(row.category);
      if (!section) {
        section = {
          category: row.category,
          total: Number(row.categoryTotal),
          items: [],
        };
        byCategory.set(row.category, section);
      }
      section.items.push(this.toRanked(row, favoriteIds));
    }

    const elegiveis = [...byCategory.values()]
      // Compara com o TOTAL da categoria, não com a lista truncada: senão
      // pedir `perSection` menor que `minItems` zera todas as seções.
      .filter((s) => s.total >= minItems);

    return {
      sections: elegiveis.slice(offsetSections, offsetSections + maxSections),
      hasMore: offsetSections + maxSections < elegiveis.length,
    };
  }

  private toRanked(r: any, favoriteIds: Set<string>): RankedProduct {
    const salesPeriod = Number(r.salesPeriod);
    const salesPrevious = Number(r.salesPrevious);
    return {
      id: r.id,
      title: r.title,
      storeName: r.storeName,
      category: r.category,
      price: Number(r.price),
      imageUrl: r.imageUrl,
      images: Array.isArray(r.images) ? r.images : [],
      rating: r.rating === null ? null : Number(r.rating),
      radarScore: r.radarScore,
      tiktokUrl: r.tiktokUrl,
      salesPeriod,
      revenuePeriod: Number(r.revenuePeriod),
      growthPct:
        salesPrevious > 0
          ? Math.round(((salesPeriod - salesPrevious) / salesPrevious) * 1000) /
            10
          : null,
      isFavorite: favoriteIds.has(r.id),
    };
  }

  async categories(): Promise<string[]> {
    const rows = await this.products
      .createQueryBuilder('p')
      .select('DISTINCT p.category', 'category')
      .orderBy('category', 'ASC')
      .getRawMany();
    return rows.map((r) => r.category);
  }

  async findOne(id: string, period = 30, userId?: string) {
    const product = await this.products.findOneBy({ id });
    if (!product) {
      throw new NotFoundException(`Produto ${id} não encontrado`);
    }
    const since = this.isoDaysAgo(period);
    const series = await this.metrics.find({
      where: { productId: id },
      order: { date: 'ASC' },
    });
    const inPeriod = series.filter((m) => m.date >= since);

    /**
     * Vendas e faturamento do período.
     *
     * A soma da série diária só existe para produto que já foi visto em várias
     * execuções — e a ingestão grava um ponto por dia. Produto recém-entrado
     * tinha série vazia, e a página mostrava "0 vendas · R$ 0,00" bem embaixo
     * de um card que dizia 51 mil vendas: o número mais desmoralizante da
     * vitrine, e ele era nosso, não do fornecedor.
     *
     * As colunas de período vêm prontas do fornecedor. A série continua sendo
     * a fonte quando existe (é mais granular e serve ao gráfico); sem ela, o
     * número do fornecedor assume.
     */
    const col = this.colunasDoPeriodo(period);
    const daColuna = {
      sales: Number(
        (product as unknown as Record<string, unknown>)[col.sales] ?? 0,
      ),
      revenue: Number(
        (product as unknown as Record<string, unknown>)[col.revenue] ?? 0,
      ),
    };
    const somaSerie = inPeriod.reduce((acc, m) => acc + m.sales, 0);
    const salesPeriod = somaSerie > 0 ? somaSerie : daColuna.sales;
    const revenuePeriod =
      somaSerie > 0
        ? inPeriod.reduce((acc, m) => acc + Number(m.revenue), 0)
        : daColuna.revenue;
    const isFavorite = userId
      ? Boolean(
          await this.favorites.findOneBy({ userId, productId: id }),
        )
      : false;

    return {
      ...product,
      price: Number(product.price),
      rating: product.rating === null ? null : Number(product.rating),
      salesPeriod,
      revenuePeriod,
      isFavorite,
      series: inPeriod.map((m) => ({
        date: m.date,
        sales: m.sales,
        revenue: Number(m.revenue),
      })),
    };
  }

  // --- Favoritos (sempre escopados ao usuário) ---

  async toggleFavorite(
    userId: string,
    productId: string,
  ): Promise<{ isFavorite: boolean }> {
    const existing = await this.favorites.findOneBy({ userId, productId });
    if (existing) {
      await this.favorites.delete({ id: existing.id });
      return { isFavorite: false };
    }
    const product = await this.products.findOneBy({ id: productId });
    if (!product) {
      throw new NotFoundException(`Produto ${productId} não encontrado`);
    }
    await this.favorites.save(this.favorites.create({ userId, productId }));
    return { isFavorite: true };
  }

  async listFavorites(userId: string) {
    const favorites = await this.favorites.find({
      where: { userId },
      relations: { product: true },
      order: { createdAt: 'DESC' },
    });
    return favorites.map((f) => ({
      ...f.product,
      price: Number(f.product.price),
      rating: f.product.rating === null ? null : Number(f.product.rating),
      favoritedAt: f.createdAt,
    }));
  }
}
