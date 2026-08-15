import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductsService } from '../products/products.service';
import { StoreOrder } from './entities/store-order.entity';
import { StoreProduct } from './entities/store-product.entity';
import { StoreSettlement } from './entities/store-settlement.entity';
import { StoresService } from './stores.service';

export interface StoreOverview {
  period: number;
  currency: string;
  grossRevenue: number;
  /** Variação % do faturamento contra o período anterior de mesmo tamanho. */
  revenueGrowthPct: number | null;
  ordersCount: number;
  unitsSold: number;
  avgTicket: number;
  canceledCount: number;
  cancelRatePct: number;
  /** Receita líquida dos pedidos já repassados (extrato importado). */
  netRevenue: number | null;
  totalFees: number | null;
  /** Quanto do bruto o marketplace ficou, nos pedidos já repassados. */
  effectiveFeePct: number | null;
  /** Lucro estimado: líquido repassado menos o custo dos produtos vendidos. */
  estimatedProfit: number | null;
  pendingShipment: number;
  lateShipment: number;
  lowStockCount: number;
  skusMissingCost: number;
  series: Array<{ date: string; revenue: number; orders: number }>;
}

export interface SkuPerformance {
  sku: string;
  title: string | null;
  units: number;
  revenue: number;
  cost: number | null;
  profit: number | null;
  marginPct: number | null;
  /** Curva ABC por faturamento acumulado (A = 80%, B = 95%, C = cauda). */
  curve: 'A' | 'B' | 'C';
  sharePct: number;
  stock: number | null;
}

export interface StoreOpportunities {
  /** Produtos em alta no radar que a loja já vende. */
  selling: Array<{ productId: string; title: string; category: string; sku: string }>;
  /** Produtos em alta no radar que faltam no catálogo da loja. */
  missing: Array<{
    productId: string;
    title: string;
    category: string;
    salesPeriod: number;
    growthPct: number | null;
    imageUrl: string | null;
  }>;
}

/** Palavras que não ajudam a casar título de produto com o catálogo. */
const STOPWORDS = new Set([
  'de',
  'da',
  'do',
  'para',
  'com',
  'sem',
  'em',
  'e',
  'o',
  'a',
  'os',
  'as',
  'um',
  'uma',
  'kit',
  'novo',
  'nova',
  'pcs',
  'un',
  'the',
  'for',
  'with',
]);

@Injectable()
export class StoresAnalyticsService {
  constructor(
    private readonly storesService: StoresService,
    private readonly productsService: ProductsService,
    @InjectRepository(StoreOrder)
    private readonly orders: Repository<StoreOrder>,
    @InjectRepository(StoreProduct)
    private readonly products: Repository<StoreProduct>,
    @InjectRepository(StoreSettlement)
    private readonly settlements: Repository<StoreSettlement>,
  ) {}

  private daysAgo(days: number): Date {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date;
  }

  // ------------------------------------------------------------------- Visão geral

  async overview(
    userId: string,
    storeId: string,
    period = 30,
  ): Promise<StoreOverview> {
    const store = await this.storesService.owned(userId, storeId);
    const since = this.daysAgo(period);
    const previousSince = this.daysAgo(period * 2);

    const totals = await this.orders
      .createQueryBuilder('o')
      .select(
        `COALESCE(SUM(CASE WHEN o.stage <> 'cancelado' AND o."placedAt" >= :since THEN o."grossAmount" END), 0)`,
        'revenue',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE o.stage <> 'cancelado' AND o."placedAt" >= :since)`,
        'orders',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE o.stage = 'cancelado' AND o."placedAt" >= :since)`,
        'canceled',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN o.stage <> 'cancelado' AND o."placedAt" < :since THEN o."grossAmount" END), 0)`,
        'previousRevenue',
      )
      .where('o."storeId" = :storeId', { storeId: store.id })
      .andWhere('o."placedAt" >= :previousSince', { previousSince })
      .setParameter('since', since)
      .getRawOne();

    const units = await this.orders
      .createQueryBuilder('o')
      .innerJoin('o.items', 'i')
      .select('COALESCE(SUM(i.quantity), 0)', 'units')
      .where('o."storeId" = :storeId', { storeId: store.id })
      .andWhere('o."placedAt" >= :since', { since })
      .andWhere(`o.stage <> 'cancelado'`)
      .getRawOne();

    const operational = await this.orders
      .createQueryBuilder('o')
      .select(`COUNT(*) FILTER (WHERE o.stage = 'pendente')`, 'pending')
      .addSelect(
        `COUNT(*) FILTER (WHERE o.stage = 'pendente' AND o."shipBy" IS NOT NULL AND o."shipBy" < NOW())`,
        'late',
      )
      .where('o."storeId" = :storeId', { storeId: store.id })
      .getRawOne();

    const catalog = await this.products
      .createQueryBuilder('p')
      .select('COUNT(*) FILTER (WHERE p.cost IS NULL)', 'missingCost')
      .addSelect(
        'COUNT(*) FILTER (WHERE p."stockAlert" IS NOT NULL AND p.stock IS NOT NULL AND p.stock <= p."stockAlert")',
        'lowStock',
      )
      .where('p."storeId" = :storeId', { storeId: store.id })
      .getRawOne();

    const financial = await this.settlementTotals(store.id, since);

    const series = await this.orders
      .createQueryBuilder('o')
      .select(`TO_CHAR(o."placedAt", 'YYYY-MM-DD')`, 'date')
      .addSelect('COALESCE(SUM(o."grossAmount"), 0)', 'revenue')
      .addSelect('COUNT(*)', 'orders')
      .where('o."storeId" = :storeId', { storeId: store.id })
      .andWhere('o."placedAt" >= :since', { since })
      .andWhere(`o.stage <> 'cancelado'`)
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany();

    const grossRevenue = Number(totals.revenue);
    const previousRevenue = Number(totals.previousRevenue);
    const ordersCount = Number(totals.orders);
    const canceledCount = Number(totals.canceled);

    return {
      period,
      currency: store.currency,
      grossRevenue: this.round(grossRevenue),
      revenueGrowthPct:
        previousRevenue > 0
          ? this.round(
              ((grossRevenue - previousRevenue) / previousRevenue) * 100,
              1,
            )
          : null,
      ordersCount,
      unitsSold: Number(units.units),
      avgTicket: ordersCount > 0 ? this.round(grossRevenue / ordersCount) : 0,
      canceledCount,
      cancelRatePct:
        ordersCount + canceledCount > 0
          ? this.round(
              (canceledCount / (ordersCount + canceledCount)) * 100,
              1,
            )
          : 0,
      ...financial,
      pendingShipment: Number(operational.pending),
      lateShipment: Number(operational.late),
      lowStockCount: Number(catalog.lowStock),
      skusMissingCost: Number(catalog.missingCost),
      series: series.map((row) => ({
        date: row.date,
        revenue: this.round(Number(row.revenue)),
        orders: Number(row.orders),
      })),
    };
  }

  /**
   * Números do extrato. Só existem se o usuário importou o relatório de
   * repasses — sem ele devolvemos null em vez de fingir um líquido.
   */
  private async settlementTotals(storeId: string, since: Date) {
    // Duas consultas de propósito: juntar os itens na mesma agregação
    // multiplicaria cada repasse pelo número de SKUs do pedido.
    const raw = await this.settlements
      .createQueryBuilder('s')
      .innerJoin(
        StoreOrder,
        'o',
        'o."storeId" = s."storeId" AND o."externalId" = s."externalOrderId"',
      )
      .select('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(s."netAmount"), 0)', 'net')
      .addSelect('COALESCE(SUM(s."grossAmount"), 0)', 'gross')
      .addSelect(
        'COALESCE(SUM(s."platformFee" + s."commissionFee" + s."affiliateFee" + s."otherFees"), 0)',
        'fees',
      )
      .where('s."storeId" = :storeId', { storeId })
      .andWhere('o."placedAt" >= :since', { since })
      .getRawOne();

    const cogsRow = await this.orders
      .createQueryBuilder('o')
      .innerJoin('o.items', 'i')
      .innerJoin(
        StoreSettlement,
        's',
        's."storeId" = o."storeId" AND s."externalOrderId" = o."externalId"',
      )
      .innerJoin(
        StoreProduct,
        'p',
        'p."storeId" = o."storeId" AND p.sku = i.sku AND p.cost IS NOT NULL',
      )
      .select('COALESCE(SUM(p.cost * i.quantity), 0)', 'cogs')
      .where('o."storeId" = :storeId', { storeId })
      .andWhere('o."placedAt" >= :since', { since })
      .getRawOne();

    if (Number(raw.count) === 0) {
      return {
        netRevenue: null,
        totalFees: null,
        effectiveFeePct: null,
        estimatedProfit: null,
      };
    }

    const net = Number(raw.net);
    const gross = Number(raw.gross);
    const fees = Number(raw.fees);
    const cogs = Number(cogsRow.cogs);

    return {
      netRevenue: this.round(net),
      totalFees: this.round(fees),
      effectiveFeePct: gross > 0 ? this.round((fees / gross) * 100, 1) : null,
      estimatedProfit: cogs > 0 ? this.round(net - cogs) : null,
    };
  }

  // ------------------------------------------------------------- Curva por SKU

  async skuPerformance(
    userId: string,
    storeId: string,
    period = 30,
  ): Promise<SkuPerformance[]> {
    const store = await this.storesService.owned(userId, storeId);
    const since = this.daysAgo(period);

    const rows = await this.orders
      .createQueryBuilder('o')
      .innerJoin('o.items', 'i')
      .leftJoin(
        StoreProduct,
        'p',
        'p."storeId" = o."storeId" AND p.sku = i.sku',
      )
      .select('i.sku', 'sku')
      .addSelect('MAX(COALESCE(p.title, i.title))', 'title')
      .addSelect('SUM(i.quantity)', 'units')
      .addSelect('SUM(i.subtotal)', 'revenue')
      .addSelect('MAX(p.cost)', 'unitCost')
      .addSelect('MAX(p.stock)', 'stock')
      .where('o."storeId" = :storeId', { storeId: store.id })
      .andWhere('o."placedAt" >= :since', { since })
      .andWhere(`o.stage <> 'cancelado'`)
      .groupBy('i.sku')
      .orderBy('SUM(i.subtotal)', 'DESC')
      .getRawMany();

    const totalRevenue = rows.reduce(
      (acc, row) => acc + Number(row.revenue),
      0,
    );

    let cumulative = 0;
    return rows.map((row) => {
      const revenue = Number(row.revenue);
      const units = Number(row.units);
      const unitCost = row.unitCost === null ? null : Number(row.unitCost);
      const cost = unitCost === null ? null : unitCost * units;

      // Custos variáveis do marketplace entram no lucro por SKU.
      const retained =
        1 - (Number(store.commissionPct) + Number(store.taxPct)) / 100;
      const profit = cost === null ? null : revenue * retained - cost;

      cumulative += revenue;
      const cumulativeShare =
        totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0;

      return {
        sku: row.sku,
        title: row.title,
        units,
        revenue: this.round(revenue),
        cost: cost === null ? null : this.round(cost),
        profit: profit === null ? null : this.round(profit),
        marginPct:
          profit !== null && revenue > 0
            ? this.round((profit / revenue) * 100, 1)
            : null,
        curve: cumulativeShare <= 80 ? 'A' : cumulativeShare <= 95 ? 'B' : 'C',
        sharePct:
          totalRevenue > 0 ? this.round((revenue / totalRevenue) * 100, 1) : 0,
        stock: row.stock === null ? null : Number(row.stock),
      } as SkuPerformance;
    });
  }

  // ------------------------------------------------------------ Oportunidades

  /**
   * Cruza o catálogo real da loja com o radar de produtos em alta da PikPok.
   * É o que nenhum ERP faz: dizer o que está subindo e você ainda não vende.
   */
  async opportunities(
    userId: string,
    storeId: string,
    period = 30,
  ): Promise<StoreOpportunities> {
    const store = await this.storesService.owned(userId, storeId);

    const [{ items: trending }, catalog] = await Promise.all([
      this.productsService.rank({ period, limit: 60, page: 1 }),
      this.products.find({
        where: { storeId: store.id },
        select: { sku: true, title: true },
      }),
    ]);

    const catalogTokens = catalog.map((item) => ({
      sku: item.sku,
      tokens: this.tokenize(item.title),
    }));

    const selling: StoreOpportunities['selling'] = [];
    const missing: StoreOpportunities['missing'] = [];

    for (const product of trending) {
      const tokens = this.tokenize(product.title);
      const match = catalogTokens.find(
        (item) => this.overlap(tokens, item.tokens) >= 0.5,
      );

      if (match) {
        selling.push({
          productId: product.id,
          title: product.title,
          category: product.category,
          sku: match.sku,
        });
      } else {
        missing.push({
          productId: product.id,
          title: product.title,
          category: product.category,
          salesPeriod: product.salesPeriod,
          growthPct: product.growthPct,
          imageUrl: product.imageUrl,
        });
      }
    }

    return { selling, missing: missing.slice(0, 20) };
  }

  private tokenize(title: string): Set<string> {
    return new Set(
      title
        .normalize('NFD')
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 3 && !STOPWORDS.has(word)),
    );
  }

  /** Fração dos tokens do produto em alta que aparecem no título da loja. */
  private overlap(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let hits = 0;
    for (const token of a) if (b.has(token)) hits += 1;
    return hits / Math.min(a.size, b.size);
  }

  private round(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
}
