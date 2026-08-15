import { api } from './api';

export interface RankedCreator {
  id: string;
  handle: string;
  name: string;
  followers: number;
  gmvPeriod: number;
  salesPeriod: number;
  category: string;
  avatarUrl: string | null;
}

export interface CreatorsQuery {
  search?: string;
  category?: string;
  sort?: 'gmv' | 'followers';
  page?: number;
  limit?: number;
}

export const creatorsService = {
  async list(query: CreatorsQuery) {
    const { data } = await api.get<{
      items: RankedCreator[];
      total: number;
      page: number;
    }>('/creators', { params: query });
    return data;
  },

  async categories(): Promise<string[]> {
    const { data } = await api.get<string[]>('/creators/categories');
    return data;
  },
};
