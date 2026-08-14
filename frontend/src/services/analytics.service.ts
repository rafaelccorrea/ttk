import { api } from './api';
import { RankedProduct } from './products.service';

export interface Overview {
  totalSales: number;
  totalRevenue: number;
  totalProducts: number;
  totalCategories: number;
  topProducts: RankedProduct[];
}

export const analyticsService = {
  async overview(): Promise<Overview> {
    const { data } = await api.get<Overview>('/analytics/overview');
    return data;
  },
};
