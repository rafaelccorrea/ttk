import { api } from './api';

export interface ViralVideo {
  id: string;
  caption: string;
  creatorHandle: string;
  views: number;
  likes: number;
  revenueEstimate: number;
  postedAt: string;
  transcript: string | null;
  productId: string | null;
  category: string;
  isSaved: boolean;
  videoUrl: string | null;
}

export interface VideoDetail extends ViralVideo {
  product: {
    id: string;
    title: string;
    category: string;
    price: number;
    imageUrl: string | null;
  } | null;
}

export interface VideosQuery {
  search?: string;
  category?: string;
  productId?: string;
  page?: number;
  limit?: number;
  saved?: boolean;
}

export const videosService = {
  async list(query: VideosQuery) {
    const { data } = await api.get<{
      items: ViralVideo[];
      total: number;
      page: number;
    }>('/videos', { params: query });
    return data;
  },

  async detail(id: string): Promise<VideoDetail> {
    const { data } = await api.get<VideoDetail>(`/videos/${id}`);
    return data;
  },

  async toggleSave(id: string): Promise<boolean> {
    const { data } = await api.post<{ isSaved: boolean }>(
      `/videos/${id}/save`,
    );
    return data.isSaved;
  },
};
