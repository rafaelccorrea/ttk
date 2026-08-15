import { api } from './api';

/** Uma categoria da vitrine de vídeos, com os seus mais vistos. */
export interface VideoSection {
  category: string;
  /** Total de vídeos da categoria (a seção mostra só os melhores). */
  total: number;
  items: ViralVideo[];
}

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
  thumbnailUrl: string | null;
  playbackUrl: string | null;
  productImageUrl: string | null;
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

  /**
   * Vitrine agrupada por categoria — mesma lógica dos produtos, para o feed
   * não misturar nichos.
   */
  async sections(perSection = 12, offset = 0, maxSections = 4) {
    const { data } = await api.get<{ sections: VideoSection[]; hasMore: boolean }>(
      '/videos/sections',
      { params: { perSection, offset, maxSections } },
    );
    return data;
  },

  /** Categorias que têm vídeo, para o filtro da tela. */
  async categories(): Promise<string[]> {
    const { data } = await api.get<string[]>('/videos/categories');
    return data;
  },

  /**
   * Resolve o MP4 tocável na hora do play.
   *
   * A URL assinada da TikTok expira em horas, por isso não é guardada no
   * banco — pedir aqui é o que faz o player abrir. Quando o espelhamento no
   * S3 estiver ligado, `permanent` volta true e a URL não expira mais.
   */
  async playback(
    id: string,
  ): Promise<{ playbackUrl: string | null; embedUrl: string | null }> {
    const { data } = await api.get<{
      playbackUrl: string | null;
      permanent: boolean;
      embedUrl: string | null;
    }>(`/videos/${id}/playback`);
    return { playbackUrl: data.playbackUrl, embedUrl: data.embedUrl };
  },

  async toggleSave(id: string): Promise<boolean> {
    const { data } = await api.post<{ isSaved: boolean }>(
      `/videos/${id}/save`,
    );
    return data.isSaved;
  },
};
