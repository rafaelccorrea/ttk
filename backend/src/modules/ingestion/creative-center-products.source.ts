import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { filterProducts } from './product-gate';

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

/** Vídeo de anúncio brasileiro, real e reproduzível. */
export interface AdVideo {
  externalId: string;
  caption: string;
  brand: string | null;
  category: string;
  likes: number;
  ctr: number;
  thumbnailUrl: string | null;
  /** MP4 do CDN do TikTok — expira em horas, renovado a cada coleta. */
  playbackUrl: string | null;
  durationSec: number | null;
  objectiveKey: string;
}

interface TopAdMaterial {
  id: string;
  ad_title: string;
  brand_name: string;
  ctr: number;
  like: number;
  industry_key: string;
  /** Objetivo da campanha — sinal de que o anúncio vende produto. */
  objective_key: string;
  video_info?: {
    cover?: string;
    duration?: number;
    /** MP4 por resolução: 360p, 480p, 540p, 720p, 1080p. */
    video_url?: Record<string, string>;
  };
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

  /**
   * Varre o Top Ads em vários períodos (feeds diferentes), fica só com os
   * anúncios de VENDA DE PRODUTO e passa cada um pelo portão de qualidade.
   * O rendimento é baixo de propósito: preferimos 5 produtos de verdade a
   * 40 linhas de publicidade genérica.
   */
  async fetchProductAds(limitPerPeriod = 60): Promise<TrendingProduct[]> {
    if (!existsSync(SESSION_FILE)) {
      this.logger.warn(
        'Sem sessão do Creative Center (cc-session.json). Rode `npm run cc:login`.',
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
      this.attachCollectors(page, materials, industryNames);

      // Períodos diferentes = feeds diferentes = mais candidatos.
      for (const period of [7, 30, 180]) {
        await page.goto(
          `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/pt?period=${period}&region=BR`,
          { waitUntil: 'domcontentloaded', timeout: 90_000 },
        );
        await page.waitForTimeout(9_000);
        for (let i = 0; i < 8; i++) {
          await page.mouse.wheel(0, 4000);
          await page.waitForTimeout(2_500);
          if (materials.size >= limitPerPeriod * 3) break;
        }
      }

      const all = [...materials.values()];
      // 1) Filtro estrutural: só anúncio de venda de produto.
      const productAds = all.filter(
        (m) => m.objective_key === 'campaign_objective_product_sales',
      );
      // 2) Portão de qualidade sobre o título.
      const { accepted, rejected } = filterProducts(
        productAds.map((m) => ({
          title: m.ad_title,
          objectiveKey: m.objective_key,
          material: m,
        })),
      );
      this.logger.log(
        `Top Ads BR: ${all.length} anúncios → ${productAds.length} de venda de produto → ${accepted.length} aprovados no portão`,
      );
      for (const r of rejected.slice(0, 5)) {
        this.logger.debug(`recusado: "${r.title}" (${r.reason})`);
      }

      return accepted.map((item, index) => {
        const m = item.material;
        const likes = Number(m.like ?? 0);
        return {
          externalId: `topads-${m.id}`,
          title: item.cleanTitle,
          category: industryNames.get(m.industry_key) || 'geral',
          price: 0,
          imageUrl: m.video_info?.cover ?? null,
          popularity: this.popularityScore(Number(m.ctr ?? 0), likes),
          rank: index + 1,
          likes,
        };
      });
    } finally {
      await browser.close();
    }
  }

  /**
   * Vídeos de anúncios BRASILEIROS, reais e reproduzíveis, do Top Ads.
   *
   * Por que aqui e não na aba "Vídeos" do Creative Center: aquela aba força
   * region=US (medido) e a de criadores está como "em breve". O Top Ads é a
   * única superfície que respeita region=BR — e cada anúncio traz cover e
   * MP4 (360p a 1080p) do CDN do TikTok.
   *
   * O MP4 expira em horas; por isso a coleta diária reescreve a URL.
   */
  async fetchAdVideos(limit = 60): Promise<AdVideo[]> {
    if (!existsSync(SESSION_FILE)) {
      this.logger.warn('Sem sessão do Creative Center. Rode `npm run cc:login`.');
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
      this.attachCollectors(page, materials, industryNames);

      for (const period of [7, 30, 180]) {
        await page.goto(
          `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/pt?period=${period}&region=BR`,
          { waitUntil: 'domcontentloaded', timeout: 90_000 },
        );
        await page.waitForTimeout(9_000);
        for (let i = 0; i < 8; i++) {
          await page.mouse.wheel(0, 4000);
          await page.waitForTimeout(2_500);
          if (materials.size >= limit * 2) break;
        }
        if (materials.size >= limit * 2) break;
      }

      const videos = [...materials.values()]
        .filter((m) => this.bestVideoUrl(m) !== null)
        .slice(0, limit)
        .map((m) => ({
          externalId: `topads-video-${m.id}`,
          caption: (m.ad_title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
          brand: m.brand_name?.trim() || null,
          category: industryNames.get(m.industry_key) || 'geral',
          likes: Number(m.like ?? 0),
          ctr: Number(m.ctr ?? 0),
          thumbnailUrl: m.video_info?.cover ?? null,
          playbackUrl: this.bestVideoUrl(m),
          durationSec: m.video_info?.duration ?? null,
          objectiveKey: m.objective_key,
        }));

      this.logger.log(
        `Top Ads BR: ${materials.size} anúncios → ${videos.length} vídeos reproduzíveis`,
      );
      return videos;
    } finally {
      await browser.close();
    }
  }

  /** Melhor resolução disponível sem estourar banda (720p de preferência). */
  private bestVideoUrl(m: TopAdMaterial): string | null {
    const urls = m.video_info?.video_url;
    if (!urls) return null;
    for (const key of ['720p', '540p', '480p', '1080p', '360p']) {
      if (urls[key]?.startsWith('http')) return urls[key];
    }
    return null;
  }

  /** Coleta as respostas assinadas que a própria página baixa. */
  private attachCollectors(
    page: {
      on: (
        event: 'response',
        handler: (res: { url: () => string; json: () => Promise<unknown> }) => void,
      ) => void;
    },
    materials: Map<string, TopAdMaterial>,
    industryNames: Map<string, string>,
  ) {
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('top_ads/v2/list')) {
        void res
          .json()
          .then((body) => {
            const list =
              (body as { data?: { materials?: TopAdMaterial[] } })?.data
                ?.materials ?? [];
            for (const m of list) {
              if (m?.id && m?.ad_title) materials.set(m.id, m);
            }
          })
          .catch(() => undefined);
      } else if (url.includes('top_ads/v2/filters')) {
        void res
          .json()
          .then((body) => {
            const walk = (node: unknown): void => {
              if (Array.isArray(node)) return node.forEach(walk);
              if (node && typeof node === 'object') {
                const obj = node as Record<string, unknown>;
                const key = (obj.value ?? obj.key) as string | undefined;
                const label = (obj.label ?? obj.name) as string | undefined;
                if (typeof key === 'string' && key.startsWith('label_') && label) {
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
  }

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
