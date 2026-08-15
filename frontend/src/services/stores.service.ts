import { api } from './api';

export type StoreDataset = 'products' | 'orders' | 'settlements';

export interface Store {
  id: string;
  name: string;
  marketplace: string;
  source: string;
  currency: string;
  dateOrder: 'dmy' | 'mdy';
  commissionPct: string;
  taxPct: string;
  createdAt: string;
}

export interface StoreOverview {
  period: number;
  currency: string;
  grossRevenue: number;
  revenueGrowthPct: number | null;
  ordersCount: number;
  unitsSold: number;
  avgTicket: number;
  canceledCount: number;
  cancelRatePct: number;
  netRevenue: number | null;
  totalFees: number | null;
  effectiveFeePct: number | null;
  estimatedProfit: number | null;
  pendingShipment: number;
  lateShipment: number;
  lowStockCount: number;
  skusMissingCost: number;
  series: Array<{ date: string; revenue: number; orders: number }>;
}

export interface StoreOrderItem {
  sku: string;
  title: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface StoreOrder {
  id: string;
  externalId: string;
  placedAt: string;
  status: string;
  stage: 'pendente' | 'enviado' | 'concluido' | 'cancelado';
  shipBy: string | null;
  shippedAt: string | null;
  shippingProvider: string | null;
  trackingCode: string | null;
  grossAmount: number;
  shippingFee: number;
  discount: number;
  late: boolean;
  items: StoreOrderItem[];
}

export interface StoreProduct {
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
  netProfit: number | null;
  marginPct: number | null;
  lowStock: boolean;
}

export interface SkuPerformance {
  sku: string;
  title: string | null;
  units: number;
  revenue: number;
  cost: number | null;
  profit: number | null;
  marginPct: number | null;
  curve: 'A' | 'B' | 'C';
  sharePct: number;
  stock: number | null;
}

export interface StoreOpportunities {
  selling: Array<{
    productId: string;
    title: string;
    category: string;
    sku: string;
  }>;
  missing: Array<{
    productId: string;
    title: string;
    category: string;
    salesPeriod: number;
    growthPct: number | null;
    imageUrl: string | null;
  }>;
}

export interface ImportIssue {
  line: number;
  message: string;
}

export interface ImportReport {
  id: string;
  dataset: StoreDataset;
  fileName: string | null;
  rowsRead: number;
  created: number;
  updated: number;
  skipped: number;
  issues: ImportIssue[];
  createdAt?: string;
}

export interface PricingResult {
  price: number | null;
  unitCost: number;
  commissionAmount: number | null;
  taxAmount: number | null;
  netProfit: number | null;
  marginPct: number | null;
  breakEvenPrice: number | null;
  suggestedPrice: number | null;
  warning: string | null;
}

export interface OrdersQuery {
  stage?: string;
  search?: string;
  period?: number;
  lateOnly?: 'true';
  page?: number;
  limit?: number;
}

export interface ProductsQuery {
  search?: string;
  sort?: 'title' | 'stock' | 'price' | 'margin';
  missingCost?: 'true';
  page?: number;
  limit?: number;
}

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
}

/**
 * Dispara o download no navegador. Precisa passar pelo axios (e não por um
 * link direto) porque a rota exige o Bearer token do usuário.
 */
async function download(url: string, params?: Record<string, unknown>) {
  const response = await api.get(url, { params, responseType: 'blob' });

  const disposition = String(response.headers['content-disposition'] ?? '');
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const fileName = match ? match[1] : 'relatorio.csv';

  const href = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export const storesService = {
  async list(): Promise<Store[]> {
    const { data } = await api.get<Store[]>('/stores');
    return data;
  },

  async create(payload: {
    name: string;
    commissionPct?: number;
    taxPct?: number;
    dateOrder?: 'dmy' | 'mdy';
  }): Promise<Store> {
    const { data } = await api.post<Store>('/stores', payload);
    return data;
  },

  async update(
    storeId: string,
    payload: Partial<{
      name: string;
      commissionPct: number;
      taxPct: number;
      dateOrder: 'dmy' | 'mdy';
    }>,
  ): Promise<Store> {
    const { data } = await api.patch<Store>(`/stores/${storeId}`, payload);
    return data;
  },

  async remove(storeId: string): Promise<void> {
    await api.delete(`/stores/${storeId}`);
  },

  async overview(storeId: string, period = 30): Promise<StoreOverview> {
    const { data } = await api.get<StoreOverview>(`/stores/${storeId}/overview`, {
      params: { period },
    });
    return data;
  },

  async orders(
    storeId: string,
    query: OrdersQuery = {},
  ): Promise<Paginated<StoreOrder>> {
    const { data } = await api.get<Paginated<StoreOrder>>(
      `/stores/${storeId}/orders`,
      { params: query },
    );
    return data;
  },

  async products(
    storeId: string,
    query: ProductsQuery = {},
  ): Promise<Paginated<StoreProduct>> {
    const { data } = await api.get<Paginated<StoreProduct>>(
      `/stores/${storeId}/products`,
      { params: query },
    );
    return data;
  },

  async updateProduct(
    storeId: string,
    productId: string,
    payload: { cost?: number; price?: number; stockAlert?: number },
  ): Promise<StoreProduct> {
    const { data } = await api.patch<StoreProduct>(
      `/stores/${storeId}/products/${productId}`,
      payload,
    );
    return data;
  },

  async skus(storeId: string, period = 30): Promise<SkuPerformance[]> {
    const { data } = await api.get<SkuPerformance[]>(`/stores/${storeId}/skus`, {
      params: { period },
    });
    return data;
  },

  async opportunities(
    storeId: string,
    period = 30,
  ): Promise<StoreOpportunities> {
    const { data } = await api.get<StoreOpportunities>(
      `/stores/${storeId}/opportunities`,
      { params: { period } },
    );
    return data;
  },

  async import(
    storeId: string,
    dataset: StoreDataset,
    file: File,
  ): Promise<ImportReport> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<ImportReport>(
      `/stores/${storeId}/imports/${dataset}`,
      form,
    );
    return data;
  },

  async imports(storeId: string): Promise<ImportReport[]> {
    const { data } = await api.get<ImportReport[]>(`/stores/${storeId}/imports`);
    return data;
  },

  exportProducts(storeId: string) {
    return download(`/stores/${storeId}/products/export`);
  },

  exportSkus(storeId: string, period = 30) {
    return download(`/stores/${storeId}/skus/export`, { period });
  },

  exportOrders(storeId: string, period = 30) {
    return download(`/stores/${storeId}/orders/export`, { period });
  },

  async simulatePricing(
    storeId: string,
    payload: {
      cost: number;
      price?: number;
      shippingCost?: number;
      otherCost?: number;
      commissionPct?: number;
      taxPct?: number;
      targetMarginPct?: number;
    },
  ): Promise<PricingResult> {
    const { data } = await api.post<PricingResult>(
      `/stores/${storeId}/pricing/simulate`,
      payload,
    );
    return data;
  },
};
