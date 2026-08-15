/**
 * Contrato único de entrada de dados de loja.
 *
 * Hoje só existe a implementação de CSV (`CsvImportSource`), que não depende de
 * homologação de ninguém: o seller exporta do Seller Center e sobe o arquivo.
 * Amanhã, `TikTokShopApiSource` (quando o app público for aprovado) e
 * `BlingApiSource` implementam esta mesma interface — o service, as entidades e
 * todas as telas continuam iguais, só muda quem produz as linhas normalizadas.
 */

export type StoreSourceKind = 'csv' | 'tiktok_shop_api' | 'bling';

export type StoreDataset = 'products' | 'orders' | 'settlements';

export const STORE_DATASETS: StoreDataset[] = [
  'products',
  'orders',
  'settlements',
];

// --------------------------------------------------------- Linhas normalizadas

export interface NormalizedProduct {
  externalId: string | null;
  sku: string;
  title: string;
  category: string | null;
  price: number | null;
  stock: number | null;
  status: string | null;
  imageUrl: string | null;
}

export interface NormalizedOrderItem {
  sku: string;
  title: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
}

export interface NormalizedOrder {
  externalId: string;
  placedAt: Date;
  status: string;
  /** Prazo de envio prometido, quando o relatório traz (usado para SLA). */
  shipBy: Date | null;
  shippedAt: Date | null;
  shippingProvider: string | null;
  trackingCode: string | null;
  grossAmount: number;
  shippingFee: number;
  discount: number;
  currency: string | null;
  items: NormalizedOrderItem[];
}

export interface NormalizedSettlement {
  externalOrderId: string;
  settledAt: Date | null;
  grossAmount: number;
  platformFee: number;
  commissionFee: number;
  affiliateFee: number;
  shippingFee: number;
  otherFees: number;
  netAmount: number;
  currency: string | null;
}

// ------------------------------------------------------------------ Resultado

/** Problema não-fatal em uma linha: ela é pulada, o resto do arquivo entra. */
export interface ImportIssue {
  /** Linha no arquivo original (1-based, contando o cabeçalho). */
  line: number;
  message: string;
}

export interface SyncResult<T> {
  rows: T[];
  issues: ImportIssue[];
  /** Total de linhas de dado lidas, incluindo as puladas. */
  rowsRead: number;
  /** Formato concreto lido (ex.: 'csv' | 'xlsx'), quando a fonte é um arquivo. */
  format?: string;
}

// -------------------------------------------------------------------- Contrato

export interface SyncContext {
  /** Arquivo enviado pelo usuário (fontes de importação manual). */
  file?: { buffer: Buffer; originalName: string };
  /** Recorte incremental (fontes de API). */
  since?: Date;
}

export interface StoreSyncSource {
  readonly kind: StoreSourceKind;

  supports(dataset: StoreDataset): boolean;

  products(ctx: SyncContext): Promise<SyncResult<NormalizedProduct>>;
  orders(ctx: SyncContext): Promise<SyncResult<NormalizedOrder>>;
  settlements(ctx: SyncContext): Promise<SyncResult<NormalizedSettlement>>;
}
