// Links públicos do TikTok — sempre abrir em nova guia.
export function tiktokProfileUrl(handle: string): string {
  return `https://www.tiktok.com/@${handle.replace(/^@/, '')}`;
}

export function tiktokHashtagUrl(hashtag: string): string {
  return `https://www.tiktok.com/tag/${encodeURIComponent(hashtag.replace(/^#/, ''))}`;
}

export const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;
