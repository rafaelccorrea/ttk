import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { StoreImport } from './entities/store-import.entity';
import { StoreOrderItem } from './entities/store-order-item.entity';
import { StoreOrder } from './entities/store-order.entity';
import { StoreProduct } from './entities/store-product.entity';
import { StoreSettlement } from './entities/store-settlement.entity';
import { Store } from './entities/store.entity';
import { normalizeOrderStage } from './pricing';
import { CsvImportSource } from './sources/csv/csv-import.source';
import { DateOrder } from './sources/csv/columns';
import {
  ImportIssue,
  NormalizedOrder,
  NormalizedProduct,
  NormalizedSettlement,
  StoreDataset,
  StoreSyncSource,
  SyncContext,
} from './sources/store-sync-source';
import { StoresService } from './stores.service';

export interface ImportReport {
  id: string;
  dataset: StoreDataset;
  fileName: string | null;
  rowsRead: number;
  created: number;
  updated: number;
  skipped: number;
  issues: ImportIssue[];
}

/** Quantos problemas guardamos por importação — o resto vira só contagem. */
const MAX_STORED_ISSUES = 50;

@Injectable()
export class StoresImportService {
  constructor(
    private readonly storesService: StoresService,
    private readonly dataSource: DataSource,
    @InjectRepository(StoreImport)
    private readonly imports: Repository<StoreImport>,
  ) {}

  /**
   * Resolve a fonte de dados da loja. Hoje só há CSV; quando o app público for
   * aprovado, basta devolver `TikTokShopApiSource` aqui — nada mais muda.
   */
  private sourceFor(store: Store): StoreSyncSource {
    return new CsvImportSource(store.dateOrder as DateOrder);
  }

  async import(
    userId: string,
    storeId: string,
    dataset: StoreDataset,
    file: { buffer: Buffer; originalName: string },
  ): Promise<ImportReport> {
    const store = await this.storesService.owned(userId, storeId);
    const source = this.sourceFor(store);
    if (!source.supports(dataset)) {
      throw new BadRequestException(
        `A fonte "${source.kind}" não fornece ${dataset}.`,
      );
    }

    const ctx: SyncContext = { file };
    const outcome =
      dataset === 'products'
        ? await this.importProducts(store, source, ctx)
        : dataset === 'orders'
          ? await this.importOrders(store, source, ctx)
          : await this.importSettlements(store, source, ctx);

    const record = await this.imports.save(
      this.imports.create({
        storeId: store.id,
        dataset,
        source: source.kind,
        fileName: file.originalName,
        rowsRead: outcome.rowsRead,
        created: outcome.created,
        updated: outcome.updated,
        skipped: outcome.issues.length,
        issues: outcome.issues.slice(0, MAX_STORED_ISSUES),
      }),
    );

    return {
      id: record.id,
      dataset,
      fileName: record.fileName,
      rowsRead: record.rowsRead,
      created: record.created,
      updated: record.updated,
      skipped: record.skipped,
      issues: record.issues,
    };
  }

  // ------------------------------------------------------------------ Produtos

  private async importProducts(
    store: Store,
    source: StoreSyncSource,
    ctx: SyncContext,
  ) {
    const result = await source.products(ctx);
    const repo = this.dataSource.getRepository(StoreProduct);

    const skus = result.rows.map((row) => row.sku);
    const existing = await this.findBySku(repo, store.id, skus);

    let created = 0;
    let updated = 0;
    const toSave: StoreProduct[] = [];

    for (const row of result.rows) {
      const current = existing.get(row.sku);
      if (current) {
        this.applyProduct(current, row);
        updated += 1;
        toSave.push(current);
      } else {
        const entity = repo.create({ storeId: store.id, sku: row.sku });
        this.applyProduct(entity, row);
        // `cost` e `stockAlert` são do usuário — nunca vêm do arquivo.
        created += 1;
        toSave.push(entity);
      }
    }

    await this.saveInChunks(repo, toSave);
    return { ...result, created, updated };
  }

  private applyProduct(entity: StoreProduct, row: NormalizedProduct): void {
    entity.externalId = row.externalId ?? entity.externalId ?? null;
    entity.title = row.title;
    entity.category = row.category ?? entity.category ?? null;
    if (row.price !== null) entity.price = String(row.price);
    if (row.stock !== null) entity.stock = row.stock;
    entity.status = row.status ?? entity.status ?? null;
    entity.imageUrl = row.imageUrl ?? entity.imageUrl ?? null;
  }

  /** Busca em lotes para não estourar o limite de parâmetros do Postgres. */
  private async findBySku(
    repo: Repository<StoreProduct>,
    storeId: string,
    skus: string[],
  ): Promise<Map<string, StoreProduct>> {
    const map = new Map<string, StoreProduct>();
    for (let i = 0; i < skus.length; i += 500) {
      const slice = skus.slice(i, i + 500);
      if (slice.length === 0) continue;
      const found = await repo.find({ where: { storeId, sku: In(slice) } });
      for (const item of found) map.set(item.sku, item);
    }
    return map;
  }

  // ------------------------------------------------------------------- Pedidos

  private async importOrders(
    store: Store,
    source: StoreSyncSource,
    ctx: SyncContext,
  ) {
    const result = await source.orders(ctx);
    const orders = this.dataSource.getRepository(StoreOrder);
    const items = this.dataSource.getRepository(StoreOrderItem);

    let created = 0;
    let updated = 0;

    for (let i = 0; i < result.rows.length; i += 200) {
      const batch = result.rows.slice(i, i + 200);
      const externalIds = batch.map((row) => row.externalId);
      const existing = new Map(
        (
          await orders.find({
            where: { storeId: store.id, externalId: In(externalIds) },
          })
        ).map((order) => [order.externalId, order]),
      );

      for (const row of batch) {
        const current = existing.get(row.externalId);
        const entity =
          current ??
          orders.create({ storeId: store.id, externalId: row.externalId });
        this.applyOrder(entity, row);

        const saved = await orders.save(entity);
        // Reimportação é a fonte da verdade: troca os itens em vez de somar.
        await items.delete({ orderId: saved.id });
        if (row.items.length > 0) {
          await items.save(
            row.items.map((item) =>
              items.create({
                orderId: saved.id,
                sku: item.sku,
                title: item.title,
                quantity: item.quantity,
                unitPrice: String(item.unitPrice),
                discount: String(item.discount),
                subtotal: String(item.subtotal),
              }),
            ),
          );
        }

        if (current) updated += 1;
        else created += 1;
      }
    }

    return { ...result, created, updated };
  }

  private applyOrder(entity: StoreOrder, row: NormalizedOrder): void {
    entity.placedAt = row.placedAt;
    entity.status = row.status;
    entity.stage = normalizeOrderStage(row.status);
    entity.shipBy = row.shipBy;
    entity.shippedAt = row.shippedAt;
    entity.shippingProvider = row.shippingProvider;
    entity.trackingCode = row.trackingCode;
    entity.grossAmount = String(row.grossAmount);
    entity.shippingFee = String(row.shippingFee);
    entity.discount = String(row.discount);
  }

  // ------------------------------------------------------------------ Repasses

  private async importSettlements(
    store: Store,
    source: StoreSyncSource,
    ctx: SyncContext,
  ) {
    const result = await source.settlements(ctx);
    const repo = this.dataSource.getRepository(StoreSettlement);

    let created = 0;
    let updated = 0;
    const toSave: StoreSettlement[] = [];

    for (let i = 0; i < result.rows.length; i += 500) {
      const batch = result.rows.slice(i, i + 500);
      const ids = batch.map((row) => row.externalOrderId);
      const existing = new Map(
        (
          await repo.find({
            where: { storeId: store.id, externalOrderId: In(ids) },
          })
        ).map((item) => [item.externalOrderId, item]),
      );

      for (const row of batch) {
        const current = existing.get(row.externalOrderId);
        const entity =
          current ??
          repo.create({
            storeId: store.id,
            externalOrderId: row.externalOrderId,
          });
        this.applySettlement(entity, row);
        if (current) updated += 1;
        else created += 1;
        toSave.push(entity);
      }
    }

    await this.saveInChunks(repo, toSave);
    return { ...result, created, updated };
  }

  private applySettlement(
    entity: StoreSettlement,
    row: NormalizedSettlement,
  ): void {
    entity.settledAt = row.settledAt;
    entity.grossAmount = String(row.grossAmount);
    entity.platformFee = String(row.platformFee);
    entity.commissionFee = String(row.commissionFee);
    entity.affiliateFee = String(row.affiliateFee);
    entity.shippingFee = String(row.shippingFee);
    entity.otherFees = String(row.otherFees);
    entity.netAmount = String(row.netAmount);
  }

  private async saveInChunks<T extends object>(
    repo: Repository<T>,
    rows: T[],
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += 250) {
      await repo.save(rows.slice(i, i + 250));
    }
  }
}
