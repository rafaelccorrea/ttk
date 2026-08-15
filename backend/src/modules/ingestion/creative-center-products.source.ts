import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';

export interface TrendingProduct {
  /** Chave estável para upsert (derivada do título quando a API não dá id). */
  externalId: string;
  title: string;
  category: string;
  /** Preço em BRL quando exposto; 0 = desconhecido (não sobrescreve). */
  price: number;
  imageUrl: string | null;
  /**
   * Índice de popularidade 0–100 do Creative Center. Sem venda real exposta,
   * ele é a base das ESTIMATIVAS diárias de vendas/receita.
   */
  popularity: number;
  rank: number;
}

const API_URL =
  'https://ads.tiktok.com/creative_radar_api/v1/popular_trend/product/list';

// Sessão logada do Creative Center (criada por `npm run cc:login`). O ranking
// de produtos exige login; com a sessão salva o scraping funciona sem captcha.
const SESSION_FILE = join(process.cwd(), 'cc-session.json');

const HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
  referer:
    'https://ads.tiktok.com/business/creativecenter/inspiration/popular/product/pc/pt',
};

/**
 * Produtos em alta do TikTok Creative Center (área pública, sem login).
 * Mesma estratégia da fonte de hashtags: 1º a API direta; se exigir
 * assinatura, abre a página com Chromium headless e raspa o DOM.
 * Cadência educada: 1x/dia via cron.
 */
@Injectable()
export class CreativeCenterProductsSource {
  private readonly logger = new Logger(CreativeCenterProductsSource.name);

  async fetchTrendingProducts(limit = 20): Promise<TrendingProduct[]> {
    const direct = await this.tryDirectApi(limit);
    if (direct.length > 0) return direct;
    this.logger.log('API de produtos bloqueada — usando navegador headless');
    return this.fetchViaBrowser(limit);
  }

  private async tryDirectApi(limit: number): Promise<TrendingProduct[]> {
    try {
      const url = `${API_URL}?page=1&limit=${limit}&period=7&country_code=BR&sort_by=popular`;
      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) return [];
      const body = (await response.json()) as {
        code?: number;
        data?: { list?: Array<Record<string, unknown>> };
      };
      const list = body?.data?.list ?? [];
      return list
        .map((item, i) => this.parseApiItem(item, i))
        .filter((p): p is TrendingProduct => p !== null);
    } catch {
      return [];
    }
  }

  // Parse defensivo: os campos do Creative Center variam entre versões.
  private parseApiItem(
    item: Record<string, unknown>,
    index: number,
  ): TrendingProduct | null {
    const title =
      (item.title as string) ??
      (item.product_name as string) ??
      (item.name as string);
    if (!title) return null;
    const category =
      ((item.first_ecom_category as Record<string, unknown>)?.value as string) ??
      (item.category as string) ??
      'geral';
    const popularity = Number(item.post_change ?? item.popularity ?? item.ctr ?? 0);
    const cover =
      (item.cover_url as string) ?? (item.image_url as string) ?? null;
    return {
      externalId: `cc-prod-${this.slug(title)}`,
      title,
      category,
      price: Number(item.price ?? 0) || 0,
      imageUrl: cover,
      popularity: this.clampPopularity(popularity),
      rank: Number(item.rank ?? index + 1),
    };
  }

  private async fetchViaBrowser(limit: number): Promise<TrendingProduct[]> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    try {
      const hasSession = existsSync(SESSION_FILE);
      if (!hasSession) {
        this.logger.warn(
          'Sem sessão do Creative Center (cc-session.json). Rode `npm run cc:login` uma vez para habilitar o ranking de produtos.',
        );
      }
      const context = await browser.newContext({
        userAgent: HEADERS['user-agent'],
        locale: 'pt-BR',
        viewport: { width: 1366, height: 2000 },
        ...(hasSession ? { storageState: SESSION_FILE } : {}),
      });
      const page = await context.newPage();

      // Com sessão logada, chama a API de DENTRO da página: os cookies e a
      // assinatura vão automáticos, igual ao navegador de verdade.
      if (hasSession) {
        await page.goto(
          'https://ads.tiktok.com/business/creativecenter/inspiration/popular/product/pc/pt',
          { waitUntil: 'domcontentloaded', timeout: 60_000 },
        );
        await page.waitForTimeout(6_000);
        const viaSession = await this.fetchInPage(page, limit);
        if (viaSession.length > 0) return viaSession;
        this.logger.warn(
          'Sessão do Creative Center não retornou produtos (expirou? rode cc:login de novo). Tentando fallback anônimo.',
        );
      }
      // Intercepta a resposta da própria API quando a página a dispara.
      const apiRows: Array<Record<string, unknown>> = [];
      page.on('response', (res) => {
        if (!res.url().includes('popular_trend/product/list')) return;
        void res
          .json()
          .then((body: { data?: { list?: Array<Record<string, unknown>> } }) => {
            for (const row of body?.data?.list ?? []) apiRows.push(row);
          })
          .catch(() => undefined);
      });

      await page.goto(
        'https://ads.tiktok.com/business/creativecenter/inspiration/popular/product/pc/pt',
        { waitUntil: 'domcontentloaded', timeout: 60_000 },
      );
      await page.waitForTimeout(10_000);

      if (apiRows.length > 0) {
        return apiRows
          .slice(0, limit)
          .map((row, i) => this.parseApiItem(row, i))
          .filter((p): p is TrendingProduct => p !== null);
      }

      // Último recurso: raspa os cards renderizados (título + categoria).
      const domRows = await page.evaluate(() => {
        const out: Array<{ title: string; ctx: string; img: string | null }> = [];
        const seen = new Set<string>();
        document
          .querySelectorAll('[class*=card], [class*=Card], [class*=item]')
          .forEach((card) => {
            const text = (card as HTMLElement).innerText ?? '';
            const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
            const title = lines[0] ?? '';
            if (title.length < 4 || seen.has(title)) return;
            if (!/CTR|Popularity|Impress|Likes/i.test(text)) return;
            seen.add(title);
            const img = card.querySelector('img')?.src ?? null;
            out.push({ title, ctx: lines.join('|'), img });
          });
        return out;
      });

      return domRows.slice(0, limit).map((row, i) => ({
        externalId: `cc-prod-${this.slug(row.title)}`,
        title: row.title,
        category: this.categoryFromCtx(row.ctx),
        price: 0,
        imageUrl: row.img,
        popularity: this.popularityFromCtx(row.ctx),
        rank: i + 1,
      }));
    } finally {
      await browser.close();
    }
  }

  /**
   * Executa o fetch da API dentro do contexto da página (sessão logada):
   * cookies, msToken e headers anti-bot vão como num navegador comum.
   * Pagina de 20 em 20 até `limit`.
   */
  private async fetchInPage(
    page: { evaluate: <T, A>(fn: (arg: A) => T | Promise<T>, arg: A) => Promise<T> },
    limit: number,
  ): Promise<TrendingProduct[]> {
    const rows: Array<Record<string, unknown>> = [];
    const pages = Math.max(1, Math.ceil(limit / 20));
    for (let p = 1; p <= pages; p++) {
      const batch = await page.evaluate(
        async ({ apiUrl, pageNum }: { apiUrl: string; pageNum: number }) => {
          const url = `${apiUrl}?page=${pageNum}&limit=20&period=7&country_code=BR&sort_by=popular`;
          const res = await fetch(url, {
            credentials: 'include',
            headers: { accept: 'application/json' },
          });
          if (!res.ok) return [] as Array<Record<string, unknown>>;
          const body = (await res.json()) as {
            data?: { list?: Array<Record<string, unknown>> };
          };
          return body?.data?.list ?? [];
        },
        { apiUrl: API_URL, pageNum: p },
      );
      if (!batch.length) break;
      rows.push(...batch);
      if (rows.length >= limit) break;
      // Cadência educada entre páginas.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return rows
      .slice(0, limit)
      .map((row, i) => this.parseApiItem(row, i))
      .filter((prod): prod is TrendingProduct => prod !== null);
  }

  private categoryFromCtx(ctx: string): string {
    const parts = ctx.split('|');
    // Card típico: "Título|Categoria|CTR|1.2%|...".
    const candidate = parts[1] ?? '';
    return candidate && !/CTR|Popularity|%|^[\d.,]/i.test(candidate)
      ? candidate
      : 'geral';
  }

  private popularityFromCtx(ctx: string): number {
    const match = ctx.match(/(?:Popularity|CTR)\|?([\d.,]+)/i);
    return this.clampPopularity(Number(match?.[1]?.replace(',', '.') ?? 0));
  }

  private clampPopularity(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.min(Math.round(value * 10) / 10, 100);
  }

  private slug(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }
}
