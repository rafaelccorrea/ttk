import { api } from './api';
import { RankedProduct } from './products.service';

export interface TopVideo {
  id: string;
  caption: string;
  creatorHandle: string;
  views: number;
  revenueEstimate: number;
  category: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
}

export interface TopCreator {
  id: string;
  name: string;
  handle: string;
  followers: number;
  gmvPeriod: number;
  avatarUrl: string | null;
}

export interface Overview {
  totalSales: number;
  totalRevenue: number;
  totalProducts: number;
  totalCategories: number;
  topProducts: RankedProduct[];
  topVideos: TopVideo[];
  topCreators: TopCreator[];
}

export const analyticsService = {
  async overview(): Promise<Overview> {
    const { data } = await api.get<Overview>('/analytics/overview');
    return data;
  },
};
