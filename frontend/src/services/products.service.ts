import { api } from './api';

export interface RankedProduct {
  id: string;
  title: string;
  storeName: string | null;
  category: string;
  price: number;
  imageUrl: string | null;
  /** Galeria de fotos reais do produto. */
  images?: string[];
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

export type ProductSort =
  | 'sales'
  | 'revenue'
  | 'growth'
  | 'price'
  | 'rating'
  | 'radar';

/** Uma categoria da vitrine, com seus melhores produtos. */
export interface ProductSection {
  category: string;
  /** Quantos produtos a categoria tem no total (o card mostra só os melhores). */
  total: number;
  items: RankedProduct[];
}

export interface RankQuery {
  period?: number;
  category?: string;
  search?: string;
  store?: string;
  minPrice?: number;
  maxPrice?: number;
  minSales?: number;
  minRevenue?: number;
  minGrowth?: number;
  minRating?: number;
  onlyFavorites?: boolean;
  withImage?: boolean;
  sort?: ProductSort;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface ProductFilterOptions {
  categories: string[];
  stores: string[];
  priceRange: { min: number; max: number };
  sorts: Array<{ value: ProductSort; label: string }>;
}

const QA = typeof location !== 'undefined' && location.search.includes('qa=1');
const CAT = ["Beleza","Casa e Cozinha","Moda Feminina","Eletronicos","Pet Shop","Saude","Esporte","Infantil","Automotivo","Papelaria"];
const qaProduct = (i) => ({ id: 'id-'+i, title: 'Kit Cinta Modeladora Premium '+i, storeName: 'Loja Oficial '+i, category: CAT[i%CAT.length], price: 39.9+i, imageUrl: 'https://picsum.photos/seed/p'+i+'/200/200', images: [], rating: 4.5, radarScore: 80-i, tiktokUrl: null, salesPeriod: 9000-i*90, revenuePeriod: 250000-i*2100, growthPct: 120-i*3, isFavorite: false });
export const productsService = {
  async rank(query: RankQuery) {
    if (QA) return { items: Array.from({length: Math.min(query.limit ?? 24, 50)}, (_, i) => qaProduct(i)) as any, total: 1234, page: 1 };
    const { data } = await api.get<{
      items: RankedProduct[];
      total: number;
      page: number;
    }>('/products', { params: query });
    return data;
  },

  /**
   * Vitrine agrupada por categoria. Evita a grade misturada onde perfume
   * aparece ao lado de furadeira — o usuário varre por nicho.
   */
  async sections(period = 30, perSection = 12, offset = 0, maxSections = 4) {
    if (QA) return { sections: (offset ? [] : [{ category: "Beleza", total: 210, items: Array.from({length: 6}, (_, i) => qaProduct(i)) }]) as any, hasMore: false };
    const { data } = await api.get<{ sections: ProductSection[]; hasMore: boolean }>(
      '/products/sections',
      { params: { period, perSection, offset, maxSections } },
    );
    return data;
  },

  async filterOptions(): Promise<ProductFilterOptions> {
    if (QA) return { categories: CAT, stores: Array.from({length: 40}, (_, i) => "Loja Oficial " + i), priceRange: {min: 10, max: 500}, sorts: [{value: "sales", label: "Mais vendidos"}] } as any;
    const { data } = await api.get<ProductFilterOptions>('/products/filters');
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
