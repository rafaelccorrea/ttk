// Links públicos do TikTok — sempre abrir em nova guia.
export function tiktokProfileUrl(handle: string): string {
  return `https://www.tiktok.com/@${handle.replace(/^@/, '')}`;
}

export function tiktokHashtagUrl(hashtag: string): string {
  return `https://www.tiktok.com/tag/${encodeURIComponent(hashtag.replace(/^#/, ''))}`;
}

export function tiktokSearchUrl(query: string): string {
  return `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`;
}

export const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * Passa imagens externas pelo proxy do backend: CDNs (TikTok, Shopee, ML...)
 * bloqueiam hotlink pelo Referer do navegador, mas respondem ao servidor.
 */
export function proxyImage(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith('http')) return url;
  return `/api/v1/media/proxy?url=${encodeURIComponent(url)}`;
}
