import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';

// Sessão logada (npm run cc:login) — com ela, a aba de vídeos aceita
// region=BR e mostra mais criadores; sem ela, cai no fluxo anônimo (US, 4).
const SESSION_FILE = join(process.cwd(), 'cc-session.json');

export interface TrendingCreator {
  handle: string;
  name: string;
  followers: number;
  videoViews: number;
  topic: string | null;
  avatarUrl: string | null;
  thumbnailUrl: string | null;
  /** MP4 do CDN do TikTok (expira em horas; renovado a cada ingestão). */
  playbackUrl: string | null;
  rank: number;
}

export interface TrendingHashtag {
  hashtag: string;
  title: string;
  views: number;
  growthRate: number;
  category: string | null;
  rank: number;
}

const BASE =
  'https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list';

// Área pública do TikTok Creative Center (sem login). Cadência educada:
// chamamos 1x/dia via cron e com user-agent de navegador comum.
const HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
  referer: 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/pt',
};

@Injectable()
export class CreativeCenterSource {
  private readonly logger = new Logger(CreativeCenterSource.name);

  /**
   * Hashtags em alta no Brasil nos últimos 7 dias.
   * 1º tenta a API direta; se ela exigir assinatura (code 40101), abre a página
   * pública com Chromium headless e intercepta a resposta da própria API.
   */
  async fetchTrendingHashtags(limit = 20): Promise<TrendingHashtag[]> {
    const direct = await this.tryDirectApi(limit);
    if (direct.length > 0) return direct;
    this.logger.log('API direta bloqueada — usando navegador headless');
    return this.fetchViaBrowser(limit);
  }

  private async tryDirectApi(limit: number): Promise<TrendingHashtag[]> {
    try {
      const url = `${BASE}?page=1&limit=${limit}&period=7&country_code=BR&sort_by=popular`;
      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) return [];
      const body = (await response.json()) as {
        code?: number;
        data?: { list?: Array<Record<string, unknown>> };
      };
      return this.parseList(body?.data?.list ?? [], true);
    } catch {
      return [];
    }
  }

  private async fetchViaBrowser(limit: number): Promise<TrendingHashtag[]> {
    // Import dinâmico: o playwright só é carregado quando necessário.
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    try {
      // Com a sessão logada (npm run cc:login), o "Ver mais" funciona e a
      // lista vai muito além das 3 primeiras posições do modo anônimo.
      const hasSession = existsSync(SESSION_FILE);
      const context = await browser.newContext({
        userAgent: HEADERS['user-agent'],
        locale: 'pt-BR',
        viewport: { width: 1366, height: 1200 },
        ...(hasSession ? { storageState: SESSION_FILE } : {}),
      });
      const page = await context.newPage();
      const collected: Array<{ tag: string; ctx: string }> = [];
      const seenTags = new Set<string>();
      for (const period of [7, 30, 120]) {
        await page.goto(
          `https://ads.tiktok.com/creative/creativeCenter/trends/hashtag?region=BR&period=${period}`,
          { waitUntil: 'domcontentloaded', timeout: 60_000 },
        );
        await page.waitForTimeout(8_000);

        // Logado: clica "Ver mais" até a lista parar de crescer.
        if (hasSession) {
          for (let round = 0; round < 6; round++) {
            const before = await this.extractRows(page);
            const more = page.getByText(/Ver mais|View More|Carregar mais/i).first();
            if (!(await more.count().catch(() => 0))) break;
            await more.click({ timeout: 5_000 }).catch(() => undefined);
            await page.waitForTimeout(3_500);
            const after = await this.extractRows(page);
            if (after.length <= before.length) break;
          }
        }

        const rows = await this.extractRows(page);
        for (const row of rows) {
          if (seenTags.has(row.tag)) continue;
          seenTags.add(row.tag);
          collected.push(row);
        }
        if (collected.length >= limit) break;
      }

      return collected
        .slice(0, limit)
        .map((r, index) => this.parseDomRow(r.tag, r.ctx, index))
        .filter((t): t is TrendingHashtag => t !== null);
    } finally {
      await browser.close();
    }
  }

  // Raspagem do DOM: a lista vem renderizada no SSR, sem XHR interceptável.
  private async extractRows(page: {
    evaluate: <T>(fn: () => T) => Promise<T>;
  }): Promise<Array<{ tag: string; ctx: string }>> {
    return page.evaluate(() => {
        const seen = new Set<string>();
        const out: Array<{ tag: string; ctx: string }> = [];
        document.querySelectorAll('*').forEach((el) => {
          if (el.children.length !== 0) return;
          const text = el.textContent?.trim() ?? '';
          if (!/^#[\p{L}\d_]+$/u.test(text) || seen.has(text)) return;
          seen.add(text);
          let row: Element = el;
          for (let i = 0; i < 6 && row.parentElement; i++) {
            row = row.parentElement;
            if (/Views|Posts/.test((row as HTMLElement).innerText ?? '')) break;
          }
          out.push({
            tag: text,
            ctx: ((row as HTMLElement).innerText ?? '').replace(/\n+/g, '|'),
          });
        });
        return out;
      });
  }

  /**
   * Criadores/vídeos em alta (aba "Video" do Creative Center). Sem login a
   * página expõe os 4 primeiros; o handle real vem do modal "View details".
   * Limitação atual: anônimo, essa aba só oferece a região US.
   */
  async fetchTrendingCreators(limit = 4): Promise<TrendingCreator[]> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    try {
      const hasSession = existsSync(SESSION_FILE);
      const context = await browser.newContext({
        userAgent: HEADERS['user-agent'],
        locale: 'pt-BR',
        viewport: { width: 1366, height: 2000 },
        ...(hasSession ? { storageState: SESSION_FILE } : {}),
      });
      const page = await context.newPage();
      // Logado, a aba de vídeos aceita region=BR; anônimo só existe US.
      await page.goto(
        `https://ads.tiktok.com/creative/creativeCenter/trends/video?period=7${hasSession ? '&region=BR' : ''}`,
        { waitUntil: 'domcontentloaded', timeout: 60_000 },
      );
      await page.waitForTimeout(9_000);

      // Logado, "Ver mais" carrega além dos primeiros cards — é daqui que sai
      // o volume de vídeos reais (com MP4) que a tela precisa para tocar.
      if (hasSession) {
        for (let round = 0; round < 5; round++) {
          const more = page.getByText(/Ver mais|View More|Carregar mais/i).first();
          if (!(await more.count().catch(() => 0))) break;
          await more.click({ timeout: 5_000 }).catch(() => undefined);
          await page.waitForTimeout(4_000);
        }
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(2_500);
      }

      // Cards visíveis: nome, seguidores, views, tópico e thumbnail (em ordem).
      const cards = await page.evaluate(() => {
        const text = document.body.innerText;
        const section = text.match(/Highest video views[\s\S]*?(View more|$)/)?.[0] ?? '';
        const rows = [...section.matchAll(
          /(?:([A-Za-zÀ-ÿ&' ]+)\n)?([^\n]+)\n([\d.,]+[KMB]?) followers\nVideo views\n([\d.,]+[KMB]?)/g,
        )].map((m) => {
          const topic = m[1]?.trim() ?? null;
          return {
            // O regex às vezes captura o rótulo do botão como "tópico".
            topic: topic && !/view details|view more/i.test(topic) ? topic : null,
            name: m[2].trim(),
            followers: m[3],
            views: m[4],
          };
        });
        const thumbs = [...document.querySelectorAll('img')]
          .map((i) => i.src)
          .filter((s) => s.includes('photomode-zoomcover') || s.includes('p16-common-sign'));
        return { rows, thumbs };
      });

      // Rótulo varia com o idioma da conta (pt-BR vs en).
      const detailButtons = page.getByText(/View details|Ver detalhes/i);
      const total = Math.min(await detailButtons.count(), limit, cards.rows.length);
      const creators: TrendingCreator[] = [];

      for (let i = 0; i < total; i++) {
        const row = cards.rows[i];
        let handle: string | null = null;
        let avatarUrl: string | null = null;
        let playbackUrl: string | null = null;
        try {
          await detailButtons.nth(i).scrollIntoViewIfNeeded();
          await detailButtons.nth(i).click({ force: true });
          await page.waitForTimeout(4_000);
          const modal = await page.evaluate(() => {
            const el = document.querySelector('.byted-modal-body, [class*=modal]');
            const text = (el as HTMLElement | null)?.innerText ?? '';
            const avatar = el
              ? [...el.querySelectorAll('img')].map((im) => im.src).find((s) => /avt|cropcenter/.test(s)) ?? null
              : null;
            const videoEl = document.querySelector('video');
            const video = videoEl
              ? videoEl.currentSrc ||
                videoEl.src ||
                [...videoEl.querySelectorAll('source')].map((s) => s.src)[0] ||
                null
              : null;
            return { firstLine: text.split('\n')[0]?.trim() ?? '', avatar, video };
          });
          if (/^[\w.]+$/.test(modal.firstLine)) handle = modal.firstLine;
          avatarUrl = modal.avatar;
          playbackUrl = modal.video?.startsWith('http') ? modal.video : null;
          await page.keyboard.press('Escape');
          await page.waitForTimeout(1_200);
        } catch {
          // modal falhou: segue sem handle (registro é descartado abaixo)
        }
        if (!handle) continue;
        creators.push({
          handle,
          name: row.name,
          followers: this.parseCompactNumber(row.followers),
          videoViews: this.parseCompactNumber(row.views),
          topic: row.topic,
          avatarUrl,
          thumbnailUrl: cards.thumbs[i] ?? null,
          playbackUrl,
          rank: i + 1,
        });
      }
      return creators;
    } finally {
      await browser.close();
    }
  }

  // Linha vinda do DOM: "1|#tag|Categoria|29K|Posts|25.5M|Views|See analytics".
  private parseDomRow(tag: string, ctx: string, index: number): TrendingHashtag | null {
    const parts = ctx.split('|').map((p) => p.trim()).filter(Boolean);
    const tagIdx = parts.indexOf(tag);
    const rank = Number(parts[tagIdx - 1]) || index + 1;
    const category = tagIdx >= 0 && parts[tagIdx + 1] && !/^[\d.,]+[KMB]?$/i.test(parts[tagIdx + 1])
      ? parts[tagIdx + 1]
      : null;
    const viewsIdx = parts.findIndex((p) => /^views$/i.test(p));
    const views = viewsIdx > 0 ? this.parseCompactNumber(parts[viewsIdx - 1]) : 0;
    return {
      hashtag: tag,
      title: tag.slice(1),
      views,
      growthRate: 0,
      category,
      rank,
    };
  }

  private parseCompactNumber(raw: string): number {
    const match = raw?.match(/^([\d.,]+)\s*([KMB])?$/i);
    if (!match) return 0;
    const value = Number(match[1].replace(',', '.'));
    const factor = { K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
    return Math.round(value * factor);
  }

  private parseList(list: Array<Record<string, unknown>>, quiet = false): TrendingHashtag[] {
    if (!Array.isArray(list) || list.length === 0) {
      if (!quiet) this.logger.warn('Creative Center sem resultados — formato pode ter mudado');
      return [];
    }
    return list
      .map((item, index) => this.parseItem(item, index))
      .filter((t): t is TrendingHashtag => t !== null);
  }

  // Parse defensivo: os nomes de campo do Creative Center mudam entre versões.
  private parseItem(item: Record<string, unknown>, index: number): TrendingHashtag | null {
    const name =
      (item.hashtag_name as string) ??
      (item.hashtagName as string) ??
      ((item.hashtag as Record<string, unknown>)?.name as string);
    if (!name) return null;

    const views = Number(item.video_views ?? item.videoViews ?? item.publish_cnt ?? 0);
    const trendData = item.trend as Array<{ value?: number }> | undefined;
    // Alguns payloads trazem série "trend" normalizada; usamos a variação ponta a ponta.
    let growthRate = 0;
    if (Array.isArray(trendData) && trendData.length >= 2) {
      const first = Number(trendData[0]?.value ?? 0);
      const last = Number(trendData[trendData.length - 1]?.value ?? 0);
      growthRate = first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0;
    }
    const industry = item.industry_info as { value?: string } | undefined;

    return {
      hashtag: name.startsWith('#') ? name : `#${name}`,
      title: name,
      views: Number.isFinite(views) ? views : 0,
      growthRate: Math.max(Math.min(growthRate, 999), -999),
      category: industry?.value ?? null,
      rank: Number(item.rank ?? index + 1),
    };
  }
}
