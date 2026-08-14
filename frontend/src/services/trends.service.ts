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

export const trendsService = {
  async list(): Promise<Trend[]> {
    const { data } = await api.get<Trend[]>('/trends');
    return data;
  },
};
