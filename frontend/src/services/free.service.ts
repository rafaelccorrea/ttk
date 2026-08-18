import { api } from './api';

/**
 * A API da conta gratuita (`docs/CONTA-FREE.md`).
 *
 * Repare no que não tem aqui: nenhuma função aceita parâmetro. Não é
 * esquecimento — as rotas do backend também não aceitam, e é isso que impede a
 * amostra de virar ferramenta. Se um dia alguém precisar passar `search` por
 * aqui, o lugar de discutir isso é o documento, não este arquivo.
 */

/** Um produto como a conta gratuita vê: prova, não entrega. */
export interface FreeProduct {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  price: number;
  /** Faixa de vendas ("25 mil+"), nunca o número exato. */
  salesRange: string;
  growthPct: number | null;
}

export interface FreeVideo {
  id: string;
  caption: string;
  creatorHandle: string;
  category: string;
  thumbnailUrl: string | null;
  viewsRange: string;
  likesRange: string;
  postedAt: string;
  /** Link para o TikTok: não servimos playback a quem não paga. */
  videoUrl: string | null;
}

export interface FreeSnapshot {
  products: FreeProduct[];
  videos: FreeVideo[];
  /** ISO: quando a amostra troca. A tela anuncia isso. */
  refreshAt: string;
  limits: { products: number; videos: number; refreshDays: number };
}

export const freeService = {
  sample: () => api.get<FreeSnapshot>('/free/sample').then((r) => r.data),
  product: (id: string) =>
    api.get<FreeProduct>(`/free/products/${id}`).then((r) => r.data),
  video: (id: string) =>
    api.get<FreeVideo>(`/free/videos/${id}`).then((r) => r.data),
};

/** "atualiza em 3 dias" — o texto do banner, a partir do `refreshAt`. */
export function diasParaTrocar(refreshAt: string): number {
  const ms = new Date(refreshAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
