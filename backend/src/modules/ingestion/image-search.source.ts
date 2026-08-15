import { Injectable, Logger } from '@nestjs/common';

const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

/**
 * Busca de imagens reais de produto via DuckDuckGo Images (sem chave).
 * Fluxo: página HTML fornece o token "vqd", depois i.js retorna JSON.
 */
@Injectable()
export class ImageSearchSource {
  private readonly logger = new Logger(ImageSearchSource.name);

  async findProductImage(title: string): Promise<string | null> {
    try {
      const query = `${title} produto`;
      const page = await fetch(
        `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
        { headers: UA },
      );
      const html = await page.text();
      const vqd = html.match(/vqd=([\d-]+)/)?.[1] ?? html.match(/vqd="([^"]+)"/)?.[1];
      if (!vqd) {
        this.logger.warn('DuckDuckGo não retornou token vqd');
        return null;
      }
      const response = await fetch(
        `https://duckduckgo.com/i.js?l=br-pt&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`,
        { headers: { ...UA, referer: 'https://duckduckgo.com/' } },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as {
        results?: Array<{ image?: string; width?: number; height?: number }>;
      };
      // Ranqueia: CDNs de marketplace (foto de produto de verdade) > tamanho
      // médio > proporção próxima do quadrado (foto de catálogo).
      const MARKETPLACE =
        /mlstatic|susercontent|shopee|alicdn|aliexpress|amazon|media-amazon|magazineluiza|magalu|americanas|shein|cdn\.shopify|kabum|casasbahia/i;
      const scored = (body.results ?? [])
        .filter((r) => r.image?.startsWith('https://') && (r.width ?? 0) >= 300)
        .map((r) => {
          const w = r.width ?? 0;
          const h = r.height ?? 1;
          const ratio = w / h;
          let score = 0;
          if (MARKETPLACE.test(r.image!)) score += 100;
          if (ratio >= 0.7 && ratio <= 1.4) score += 30; // foto de catálogo
          if (w >= 500 && w <= 2000) score += 20;
          if (/logo|icon|banner/i.test(r.image!)) score -= 50;
          return { url: r.image!, score };
        })
        .sort((a, b) => b.score - a.score);
      return scored[0]?.url ?? null;
    } catch (err) {
      this.logger.warn(`Busca de imagem falhou p/ "${title}": ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
