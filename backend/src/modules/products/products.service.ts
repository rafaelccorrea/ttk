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

@Injectable()
export class ProductsService {
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

  async rank(
    query: QueryProductsDto,
    userId?: string,
  ): Promise<{ items: RankedProduct[]; total: number; page: number }> {
    const period = query.period ?? 30;
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;
    const current = this.isoDaysAgo(period);
    const previous = this.isoDaysAgo(period * 2);

    const qb = this.products
      .createQueryBuilder('p')
      .leftJoin(
        ProductMetricDaily,
        'm',
        'm."productId" = p.id AND m.date >= :previous',
        { previous },
      )
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
      .addSelect(
        'COALESCE(SUM(CASE WHEN m.date >= :current THEN m.sales END), 0)',
        'salesPeriod',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN m.date >= :current THEN m.revenue END), 0)',
        'revenuePeriod',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN m.date < :current THEN m.sales END), 0)',
        'salesPrevious',
      )
      .setParameter('current', current)
      .groupBy('p.id');

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

    applyWhere(qb);

    // Filtros sobre agregados do período (HAVING).
    if (query.minSales !== undefined) {
      qb.andHaving(
        'COALESCE(SUM(CASE WHEN m.date >= :current THEN m.sales END), 0) >= :minSales',
        { minSales: query.minSales },
      );
    }
    if (query.minRevenue !== undefined) {
      qb.andHaving(
        'COALESCE(SUM(CASE WHEN m.date >= :current THEN m.revenue END), 0) >= :minRevenue',
        { minRevenue: query.minRevenue },
      );
    }
    if (query.minGrowth !== undefined) {
      // Crescimento = (atual - anterior) / anterior. Sem base anterior não dá
      // para calcular percentual, então esses produtos ficam de fora do filtro.
      qb.andHaving(
        `COALESCE(SUM(CASE WHEN m.date < :current THEN m.sales END), 0) > 0
         AND ((COALESCE(SUM(CASE WHEN m.date >= :current THEN m.sales END), 0)
               - COALESCE(SUM(CASE WHEN m.date < :current THEN m.sales END), 0))
              * 100.0
              / NULLIF(COALESCE(SUM(CASE WHEN m.date < :current THEN m.sales END), 0), 0)
             ) >= :minGrowth`,
        { minGrowth: query.minGrowth },
      );
    }

    const direction = query.order === 'asc' ? 'ASC' : 'DESC';
    const sortExpression = this.sortExpression(query.sort);
    // Desempate por id: sem ele, linhas empatadas trocam de posição entre
    // requisições (sort instável do Postgres) e podem duplicar/sumir na paginação.
    qb.orderBy(sortExpression, direction).addOrderBy('p.id', 'ASC');

    // Total: com filtros de agregado, contar linhas do produto não basta —
    // é preciso contar o resultado agrupado já filtrado.
    const hasAggregateFilter =
      query.minSales !== undefined ||
      query.minRevenue !== undefined ||
      query.minGrowth !== undefined;

    let total: number;
    if (hasAggregateFilter) {
      const countRows = await qb.clone().getRawMany();
      total = countRows.length;
    } else {
      const countQb = this.products.createQueryBuilder('p');
      applyWhere(countQb as unknown as typeof qb);
      total = await countQb.getCount();
    }

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
  private sortExpression(sort: QueryProductsDto['sort']): string {
    switch (sort) {
      case 'revenue':
        return '"revenuePeriod"';
      case 'price':
        return 'p.price';
      case 'rating':
        // Sem nota, o produto vai para o fim em vez de virar "melhor avaliado".
        return 'COALESCE(p.rating, 0)';
      case 'radar':
        return 'COALESCE(p."radarScore", 0)';
      case 'growth':
        return `CASE
          WHEN COALESCE(SUM(CASE WHEN m.date < :current THEN m.sales END), 0) = 0 THEN NULL
          ELSE (COALESCE(SUM(CASE WHEN m.date >= :current THEN m.sales END), 0)
                - COALESCE(SUM(CASE WHEN m.date < :current THEN m.sales END), 0))
               * 100.0
               / COALESCE(SUM(CASE WHEN m.date < :current THEN m.sales END), 0)
        END`;
      default:
        return '"salesPeriod"';
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
  ): Promise<{
    sections: Array<{
      category: string;
      total: number;
      items: RankedProduct[];
    }>;
  }> {
    const current = this.isoDaysAgo(period);
    const previous = this.isoDaysAgo(period * 2);

    const rows = await this.products.query(
      `
      WITH agg AS (
        SELECT p.id, p.title, p."storeName", p.category, p.price, p."imageUrl",
               p.images, p.rating, p."radarScore", p."tiktokUrl",
               COALESCE(SUM(CASE WHEN m.date >= $1 THEN m.sales END), 0)   AS "salesPeriod",
               COALESCE(SUM(CASE WHEN m.date >= $1 THEN m.revenue END), 0) AS "revenuePeriod",
               COALESCE(SUM(CASE WHEN m.date <  $1 THEN m.sales END), 0)   AS "salesPrevious"
          FROM products p
          LEFT JOIN product_metrics_daily m
                 ON m."productId" = p.id AND m.date >= $2
         GROUP BY p.id
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
       WHERE rn <= $3
       ORDER BY "categorySales" DESC, category ASC, rn ASC
      `,
      [current, previous, perSection],
    );

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

    return {
      sections: [...byCategory.values()]
        .filter((s) => s.items.length >= minItems)
        .slice(0, maxSections),
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
    const salesPeriod = inPeriod.reduce((acc, m) => acc + m.sales, 0);
    const revenuePeriod = inPeriod.reduce(
      (acc, m) => acc + Number(m.revenue),
      0,
    );
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
