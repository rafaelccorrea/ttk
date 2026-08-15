import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';

export interface TrendingProduct {
  /** Chave estável para upsert (id do anúncio no Top Ads). */
  externalId: string;
  title: string;
  category: string;
  /** Preço em BRL quando exposto; 0 = desconhecido (não sobrescreve). */
  price: number;
  imageUrl: string | null;
  /**
   * Índice 0–100 derivado de CTR + likes do anúncio. Sem venda pública,
   * ele é a base das ESTIMATIVAS diárias de vendas/receita.
   */
  popularity: number;
  rank: number;
  /** Likes do anúncio (dado real, usado na estimativa). */
  likes: number;
}

// Sessão logada do Creative Center (criada por `npm run cc:login`). O TikTok
// removeu o ranking público de produtos; a fonte atual é o Top Ads (anúncios
// de alta performance no BR), cujo ad_title costuma ser o nome do produto.
const SESSION_FILE = join(process.cwd(), 'cc-session.json');

const TOP_ADS_PAGE =
  'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/pt?period=30&region=BR';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

interface TopAdMaterial {
  id: string;
  ad_title: string;
  brand_name: string;
  ctr: number;
  like: number;
  industry_key: string;
  video_info?: { cover?: string };
}

/**
 * Produtos em alta a partir do Top Ads do TikTok Creative Center (BR).
 * Estratégia: abrir a página logada com Chromium headless e INTERCEPTAR as
 * respostas que a própria página baixa (a API exige assinatura, então
 * chamadas manuais não funcionam — as da página vêm assinadas de graça).
 * Cadência educada: 1x/dia via cron.
 */
@Injectable()
export class CreativeCenterProductsSource {
  private readonly logger = new Logger(CreativeCenterProductsSource.name);

  async fetchTrendingProducts(limit = 40): Promise<TrendingProduct[]> {
    if (!existsSync(SESSION_FILE)) {
      this.logger.warn(
        'Sem sessão do Creative Center (cc-session.json). Rode `npm run cc:login` uma vez para habilitar a coleta de produtos.',
      );
      return [];
    }

    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    try {
      const context = await browser.newContext({
        userAgent: UA,
        locale: 'pt-BR',
        viewport: { width: 1440, height: 2400 },
        storageState: SESSION_FILE,
      });
      const page = await context.newPage();

      const materials = new Map<string, TopAdMaterial>();
      const industryNames = new Map<string, string>();

      page.on('response', (res) => {
        const url = res.url();
        if (url.includes('top_ads/v2/list')) {
          void res
            .json()
            .then((body: { data?: { materials?: TopAdMaterial[] } }) => {
              for (const m of body?.data?.materials ?? []) {
                if (m?.id && m?.ad_title) materials.set(m.id, m);
              }
            })
            .catch(() => undefined);
        } else if (url.includes('top_ads/v2/filters')) {
          // Mapeia industry_key (label_xxx) → nome legível da categoria.
          void res
            .json()
            .then((body: unknown) => {
              const walk = (node: unknown): void => {
                if (Array.isArray(node)) return node.forEach(walk);
                if (node && typeof node === 'object') {
                  const obj = node as Record<string, unknown>;
                  const key = (obj.value ?? obj.key) as string | undefined;
                  const label = (obj.label ?? obj.name) as string | undefined;
                  if (key?.startsWith?.('label_') && label) {
                    industryNames.set(key, label);
                  }
                  Object.values(obj).forEach(walk);
                }
              };
              walk(body);
            })
            .catch(() => undefined);
        }
      });

      await page.goto(TOP_ADS_PAGE, {
        waitUntil: 'domcontentloaded',
        timeout: 90_000,
      });
      await page.waitForTimeout(10_000);

      // Rola para a página buscar mais lotes (cadência educada).
      for (let i = 0; i < 6 && materials.size < limit; i++) {
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(3_500);
      }

      const list = [...materials.values()].slice(0, limit);
      this.logger.log(`Top Ads BR: ${list.length} anúncios coletados`);

      return list.map((m, index) => {
        const likes = Number(m.like ?? 0);
        const ctr = Number(m.ctr ?? 0);
        return {
          externalId: `topads-${m.id}`,
          title: this.cleanTitle(m.ad_title),
          category:
            industryNames.get(m.industry_key) || m.brand_name || 'geral',
          price: 0,
          imageUrl: m.video_info?.cover ?? null,
          popularity: this.popularityScore(ctr, likes),
          rank: index + 1,
          likes,
        };
      });
    } finally {
      await browser.close();
    }
  }

  /** 0–100: metade CTR (2%+ = teto), metade engajamento (10k likes = teto). */
  private popularityScore(ctr: number, likes: number): number {
    const ctrScore = Math.min(ctr / 2, 1) * 50;
    const likeScore = Math.min(likes / 10_000, 1) * 50;
    return Math.round((ctrScore + likeScore) * 10) / 10;
  }

  private cleanTitle(title: string): string {
    return title.replace(/\s+/g, ' ').trim().slice(0, 140);
  }
}
