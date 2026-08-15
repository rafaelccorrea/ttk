import { api } from './api';

export interface Trend {
  id: string;
  title: string;
  hashtag?: string;
  category?: string;
  views: string;
  growthRate: string;
  createdAt: string;
}

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

export interface TrendsOverview {
  referenceDate: string | null;
  categories: CategoryTrend[];
  risingProducts: RisingProduct[];
  curated: Trend[];
}

export const trendsService = {
  async list(): Promise<Trend[]> {
    const { data } = await api.get<Trend[]>('/trends');
    return data;
  },
  async overview(): Promise<TrendsOverview> {
    const { data } = await api.get<TrendsOverview>('/trends/overview');
    return data;
  },
};
