import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateStoreDto } from './dto/create-store.dto';
import {
  QueryStoreOrdersDto,
  QueryStoreProductsDto,
} from './dto/query-store.dto';
import { SimulatePricingDto } from './dto/simulate-pricing.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { UpdateStoreProductDto } from './dto/update-store-product.dto';
import { StoreImport } from './entities/store-import.entity';
import { StoreOrder } from './entities/store-order.entity';
import { StoreProduct } from './entities/store-product.entity';
import { Store } from './entities/store.entity';
import { calculatePricing, PricingResult } from './pricing';

export interface StoreProductRow {
  id: string;
  sku: string;
  title: string;
  category: string | null;
  price: number | null;
  cost: number | null;
  stock: number | null;
  stockAlert: number | null;
  status: string | null;
  imageUrl: string | null;
  /** Lucro por unidade após comissão e imposto da loja. Null sem preço ou custo. */
  netProfit: number | null;
  marginPct: number | null;
  lowStock: boolean;
}

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(StoreProduct)
    private readonly products: Repository<StoreProduct>,
    @InjectRepository(StoreOrder)
    private readonly orders: Repository<StoreOrder>,
    @InjectRepository(StoreImport)
    private readonly imports: Repository<StoreImport>,
  ) {}

  // --------------------------------------------------------------- Lojas (CRUD)

  async create(userId: string, dto: CreateStoreDto): Promise<Store> {
    const store = this.stores.create({
      userId,
      name: dto.name,
      marketplace: dto.marketplace ?? 'tiktok_shop',
      currency: dto.currency ?? 'BRL',
      dateOrder: dto.dateOrder ?? 'dmy',
      commissionPct: String(dto.commissionPct ?? 0),
      taxPct: String(dto.taxPct ?? 0),
      source: 'csv',
    });
    return this.stores.save(store);
  }

  async list(userId: string): Promise<Store[]> {
    return this.stores.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Carrega a loja garantindo que ela pertence ao usuário do token. */
  async owned(userId: string, storeId: string): Promise<Store> {
    const store = await this.stores.findOneBy({ id: storeId, userId });
    if (!store) {
      throw new NotFoundException('Loja não encontrada');
    }
    return store;
  }

  async update(
    userId: string,
    storeId: string,
    dto: UpdateStoreDto,
  ): Promise<Store> {
    const store = await this.owned(userId, storeId);
    if (dto.name !== undefined) store.name = dto.name;
    if (dto.marketplace !== undefined) store.marketplace = dto.marketplace;
    if (dto.currency !== undefined) store.currency = dto.currency;
    if (dto.dateOrder !== undefined) store.dateOrder = dto.dateOrder;
    if (dto.commissionPct !== undefined) {
      store.commissionPct = String(dto.commissionPct);
    }
    if (dto.taxPct !== undefined) store.taxPct = String(dto.taxPct);
    return this.stores.save(store);
  }

  async remove(userId: string, storeId: string): Promise<{ deleted: true }> {
    const store = await this.owned(userId, storeId);
    await this.stores.delete({ id: store.id });
    return { deleted: true };
  }

  // ------------------------------------------------------------------ Produtos

  async listProducts(
    userId: string,
    storeId: string,
    query: QueryStoreProductsDto,
  ): Promise<{ items: StoreProductRow[]; total: number; page: number }> {
    const store = await this.owned(userId, storeId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const qb = this.products
      .createQueryBuilder('p')
      .where('p."storeId" = :storeId', { storeId: store.id });

    if (query.search) {
      qb.andWhere(
        '(p.sku ILIKE :search OR p.title ILIKE :search OR p.category ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }
    if (query.missingCost === 'true') {
      qb.andWhere('p.cost IS NULL');
    }

    // Lucro unitário = preço - custo - (comissão + imposto) sobre o preço.
    const retained =
      1 - (Number(store.commissionPct) + Number(store.taxPct)) / 100;
    const netExpression = `(p.price * :retained - p.cost)`;
    qb.setParameter('retained', retained);

    if (query.sort === 'margin') {
      qb.orderBy(netExpression, 'DESC', 'NULLS LAST');
    } else if (query.sort === 'stock') {
      qb.orderBy('p.stock', 'ASC', 'NULLS LAST');
    } else if (query.sort === 'price') {
      qb.orderBy('p.price', 'DESC', 'NULLS LAST');
    } else {
      qb.orderBy('p.title', 'ASC');
    }

    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: rows.map((row) => this.toProductRow(row, retained)),
      total,
      page,
    };
  }

  private toProductRow(row: StoreProduct, retained: number): StoreProductRow {
    const price = row.price === null ? null : Number(row.price);
    const cost = row.cost === null ? null : Number(row.cost);
    const netProfit =
      price !== null && cost !== null
        ? Math.round((price * retained - cost) * 100) / 100
        : null;

    return {
      id: row.id,
      sku: row.sku,
      title: row.title,
      category: row.category,
      price,
      cost,
      stock: row.stock,
      stockAlert: row.stockAlert,
      status: row.status,
      imageUrl: row.imageUrl,
      netProfit,
      marginPct:
        netProfit !== null && price !== null && price > 0
          ? Math.round((netProfit / price) * 1000) / 10
          : null,
      lowStock:
        row.stock !== null &&
        row.stockAlert !== null &&
        row.stock <= row.stockAlert,
    };
  }

  async updateProduct(
    userId: string,
    storeId: string,
    productId: string,
    dto: UpdateStoreProductDto,
  ): Promise<StoreProductRow> {
    const store = await this.owned(userId, storeId);
    const product = await this.products.findOneBy({
      id: productId,
      storeId: store.id,
    });
    if (!product) {
      throw new NotFoundException('Produto não encontrado nesta loja');
    }

    if (dto.cost !== undefined) product.cost = String(dto.cost);
    if (dto.price !== undefined) product.price = String(dto.price);
    if (dto.stockAlert !== undefined) product.stockAlert = dto.stockAlert;

    const saved = await this.products.save(product);
    const retained =
      1 - (Number(store.commissionPct) + Number(store.taxPct)) / 100;
    return this.toProductRow(saved, retained);
  }

  // ------------------------------------------------------------------- Pedidos

  async listOrders(
    userId: string,
    storeId: string,
    query: QueryStoreOrdersDto,
  ) {
    const store = await this.owned(userId, storeId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const period = query.period ?? 30;

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - period);

    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'i')
      .where('o."storeId" = :storeId', { storeId: store.id })
      .andWhere('o."placedAt" >= :since', { since });

    if (query.stage) {
      qb.andWhere('o.stage = :stage', { stage: query.stage });
    }
    if (query.lateOnly === 'true') {
      qb.andWhere('o.stage = :pending', { pending: 'pendente' })
        .andWhere('o."shipBy" IS NOT NULL')
        .andWhere('o."shipBy" < NOW()');
    }
    if (query.search) {
      qb.andWhere(
        `(o."externalId" ILIKE :search OR EXISTS (
           SELECT 1 FROM store_order_items si
           WHERE si."orderId" = o.id AND si.sku ILIKE :search
         ))`,
        { search: `%${query.search}%` },
      );
    }

    const [rows, total] = await qb
      .orderBy('o."placedAt"', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const now = Date.now();
    const items = rows.map((order) => ({
      id: order.id,
      externalId: order.externalId,
      placedAt: order.placedAt,
      status: order.status,
      stage: order.stage,
      shipBy: order.shipBy,
      shippedAt: order.shippedAt,
      shippingProvider: order.shippingProvider,
      trackingCode: order.trackingCode,
      grossAmount: Number(order.grossAmount),
      shippingFee: Number(order.shippingFee),
      discount: Number(order.discount),
      late:
        order.stage === 'pendente' &&
        order.shipBy !== null &&
        order.shipBy.getTime() < now,
      items: (order.items ?? []).map((item) => ({
        sku: item.sku,
        title: item.title,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        subtotal: Number(item.subtotal),
      })),
    }));

    return { items, total, page };
  }

  // --------------------------------------------------------------- Importações

  async listImports(userId: string, storeId: string): Promise<StoreImport[]> {
    const store = await this.owned(userId, storeId);
    return this.imports.find({
      where: { storeId: store.id },
      order: { createdAt: 'DESC' },
      take: 30,
    });
  }

  // ------------------------------------------------------------------ Precifi.

  async simulatePricing(
    userId: string,
    storeId: string,
    dto: SimulatePricingDto,
  ): Promise<PricingResult> {
    const store = await this.owned(userId, storeId);
    return calculatePricing({
      cost: dto.cost,
      price: dto.price,
      shippingCost: dto.shippingCost,
      otherCost: dto.otherCost,
      commissionPct: dto.commissionPct ?? Number(store.commissionPct),
      taxPct: dto.taxPct ?? Number(store.taxPct),
      targetMarginPct: dto.targetMarginPct,
    });
  }
}
