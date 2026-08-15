import { api } from './api';

export interface FavoriteProduct {
  id: string;
  title: string;
  storeName: string | null;
  category: string;
  price: number;
  rating: number | null;
  radarScore: number | null;
  favoritedAt: string;
}

export const favoritesService = {
  async list(): Promise<FavoriteProduct[]> {
    const { data } = await api.get<FavoriteProduct[]>('/products/favorites');
    return data;
  },

  async remove(id: string): Promise<boolean> {
    const { data } = await api.post<{ isFavorite: boolean }>(
      `/products/${id}/favorite`,
    );
    return data.isFavorite;
  },
};
