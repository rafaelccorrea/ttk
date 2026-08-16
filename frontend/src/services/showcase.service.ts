import { api } from './api';

export interface ShowcaseProduct {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  price: number;
  /** Faixa de vendas ("1.000+") — o número exato é do plano pago. */
  salesRange: string;
  growthPct: number | null;
}

export interface ShowcaseSnapshot {
  products: ShowcaseProduct[];
  stats: { products: number; categories: number };
  delayDays: number;
}

/**
 * Única chamada de dado que roda sem login: alimenta a amostra da landing.
 * O recorte (o que vem e o que fica de fora) é decidido no backend — ver
 * `showcase.service.ts` lá.
 */
export const showcaseService = {
  snapshot: () =>
    api.get<ShowcaseSnapshot>('/showcase').then((r) => r.data),
};
