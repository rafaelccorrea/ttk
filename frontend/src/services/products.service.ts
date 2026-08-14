import { api } from './api';

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
  isFavorite: boolean;
}

export interface ProductDetail extends Omit<RankedProduct, 'growthPct'> {
  series: Array<{ date: string; sales: number; revenue: number }>;
}

export interface RankQuery {
  period?: number;
  category?: string;
  search?: string;
  sort?: 'sales' | 'revenue';
  page?: number;
  limit?: number;
}

export const productsService = {
  async rank(query: RankQuery) {
    const { data } = await api.get<{
      items: RankedProduct[];
      total: number;
      page: number;
    }>('/products', { params: query });
    return data;
  },

  async categories(): Promise<string[]> {
    const { data } = await api.get<string[]>('/products/categories');
    return data;
  },

  async detail(id: string, period = 30): Promise<ProductDetail> {
    const { data } = await api.get<ProductDetail>(`/products/${id}`, {
      params: { period },
    });
    return data;
  },

  async toggleFavorite(id: string): Promise<boolean> {
    const { data } = await api.post<{ isFavorite: boolean }>(
      `/products/${id}/favorite`,
    );
    return data.isFavorite;
  },
};
