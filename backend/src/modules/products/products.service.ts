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

    if (query.category) {
      qb.andWhere('p.category = :category', { category: query.category });
    }
    if (query.search) {
      qb.andWhere('(p.title ILIKE :search OR p.storeName ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    const sortColumn =
      query.sort === 'revenue' ? '"revenuePeriod"' : '"salesPeriod"';
    // Desempate por id: sem ele, linhas empatadas trocam de posição entre
    // requisições (sort instável do Postgres) e podem duplicar/sumir na paginação.
    qb.orderBy(sortColumn, 'DESC').addOrderBy('p.id', 'ASC');

    const countQb = this.products.createQueryBuilder('p');
    if (query.category) {
      countQb.andWhere('p.category = :category', { category: query.category });
    }
    if (query.search) {
      countQb.andWhere('(p.title ILIKE :search OR p.storeName ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }
    const total = await countQb.getCount();

    const rows = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();

    const favoriteIds = userId
      ? new Set(
          (await this.favorites.find({ where: { userId } })).map(
            (f) => f.productId,
          ),
        )
      : new Set<string>();

    const items = rows.map((r) => this.toRanked(r, favoriteIds));
    return { items, total, page };
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
