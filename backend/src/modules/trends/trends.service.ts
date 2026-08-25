import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { CreateTrendDto } from './dto/create-trend.dto';
import { Trend } from './entities/trend.entity';

export interface CategoryTrend {
  category: string;
  recentSales: number;
  previousSales: number;
  recentRevenue: number;
  growthPct: number | null;
  topProduct: string | null;
}

export interface RisingProduct {
  id: string;
  title: string;
  category: string;
  recentSales: number;
  previousSales: number;
  recentRevenue: number;
  growthPct: number | null;
}

@Injectable()
export class TrendsService {
  constructor(
    @InjectRepository(Trend)
    private readonly repository: Repository<Trend>,
    @InjectRepository(ProductMetricDaily)
    private readonly metrics: Repository<ProductMetricDaily>,
  ) {}

  create(dto: CreateTrendDto): Promise<Trend> {
    return this.repository.save(this.repository.create(dto));
  }

  findAll(): Promise<Trend[]> {
    return this.repository.find({ order: { createdAt: 'DESC', id: 'ASC' } });
  }

  async findOne(id: string): Promise<Trend> {
    const trend = await this.repository.findOneBy({ id });
    if (!trend) {
      throw new NotFoundException(`Trend ${id} não encontrada`);
    }
    return trend;
  }

  /**
   * Tendências derivadas dos dados reais: compara os últimos 7 dias com os 7
   * anteriores (relativo à data mais recente da série) por categoria e produto.
   */
  /**
   * A série diária muda uma vez por dia (ingestão); recalcular três
   * agregações por visita à tela era só latência. Cinco minutos de cache.
   */
  private overviewCache: { value: unknown; expiresAt: number } | null = null;

  async overview() {
    if (this.overviewCache && this.overviewCache.expiresAt > Date.now()) {
      return this.overviewCache.value;
    }
    const value = await this.calcularOverview();
    this.overviewCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
    return value;
  }

  private async calcularOverview() {
    const latestRow = await this.metrics
      .createQueryBuilder('m')
      .select('MAX(m.date)', 'max')
      .getRawOne<{ max: string | Date | null }>();
    if (!latestRow?.max) {
      return { referenceDate: null, categories: [], risingProducts: [], curated: await this.findAll() };
    }
    const latest = this.toIsoDate(latestRow.max);

    const mid = this.shiftDate(latest, -7);
    const start = this.shiftDate(latest, -14);

    const categoriesQb = this.metrics
      .createQueryBuilder('m')
      .innerJoin('m.product', 'p')
      .select('p.category', 'category')
      .addSelect('SUM(CASE WHEN m.date > :mid THEN m.sales ELSE 0 END)', 'recentSales')
      .addSelect('SUM(CASE WHEN m.date <= :mid THEN m.sales ELSE 0 END)', 'previousSales')
      .addSelect('SUM(CASE WHEN m.date > :mid THEN m.revenue ELSE 0 END)', 'recentRevenue')
      .where('m.date > :start', { start, mid })
      .groupBy('p.category');

    const productsQb = this.metrics
      .createQueryBuilder('m')
      .innerJoin('m.product', 'p')
      .select('p.id', 'id')
      .addSelect('p.title', 'title')
      .addSelect('p.category', 'category')
      .addSelect('SUM(CASE WHEN m.date > :mid THEN m.sales ELSE 0 END)', 'recentSales')
      .addSelect('SUM(CASE WHEN m.date <= :mid THEN m.sales ELSE 0 END)', 'previousSales')
      .addSelect('SUM(CASE WHEN m.date > :mid THEN m.revenue ELSE 0 END)', 'recentRevenue')
      .where('m.date > :start', { start, mid })
      .groupBy('p.id')
      .addGroupBy('p.title')
      .addGroupBy('p.category');

    // As três leituras são independentes: uma ida de latência em vez de três.
    const [categoriesRaw, productsRaw, curated] = await Promise.all([
      categoriesQb.getRawMany(),
      productsQb.getRawMany(),
      this.findAll(),
    ]);

    const risingProducts: RisingProduct[] = productsRaw
      .map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        recentSales: Number(r.recentSales),
        previousSales: Number(r.previousSales),
        recentRevenue: Number(r.recentRevenue),
        growthPct: this.growth(Number(r.recentSales), Number(r.previousSales)),
      }))
      .filter((r) => r.recentSales > 0)
      .sort((a, b) => (b.growthPct ?? -Infinity) - (a.growthPct ?? -Infinity))
      .slice(0, 10);

    const topByCategory = new Map<string, string>();
    for (const p of risingProducts) {
      if (!topByCategory.has(p.category)) topByCategory.set(p.category, p.title);
    }

    const categories: CategoryTrend[] = categoriesRaw
      .map((r) => ({
        category: r.category,
        recentSales: Number(r.recentSales),
        previousSales: Number(r.previousSales),
        recentRevenue: Number(r.recentRevenue),
        growthPct: this.growth(Number(r.recentSales), Number(r.previousSales)),
        topProduct: topByCategory.get(r.category) ?? null,
      }))
      .sort((a, b) => (b.growthPct ?? -Infinity) - (a.growthPct ?? -Infinity));

    return {
      referenceDate: latest,
      categories,
      risingProducts,
      curated,
    };
  }

  private growth(recent: number, previous: number): number | null {
    if (previous <= 0) return null;
    return Math.round(((recent - previous) / previous) * 1000) / 10;
  }

  /**
   * Colunas `date` voltam do driver `pg` como Date (meia-noite no fuso local)
   * quando lidas via getRawOne/getRawMany — sem a conversão do TypeORM. Aqui
   * normalizamos para 'YYYY-MM-DD' usando os componentes locais, para não
   * escorregar um dia por causa do offset.
   */
  private toIsoDate(value: string | Date): string {
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return String(value).slice(0, 10);
  }

  private shiftDate(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
