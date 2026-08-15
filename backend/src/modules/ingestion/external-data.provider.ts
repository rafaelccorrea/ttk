import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Produto vindo de um fornecedor pago de dados (ex.: Kalodata, EchoTik,
 * Shoplus). Diferente do Creative Center, esses serviços entregam VENDAS e
 * RECEITA reais por produto — dado que o TikTok não expõe publicamente.
 */
export interface ExternalProduct {
  externalId: string;
  title: string;
  category: string;
  price: number;
  imageUrl: string | null;
  storeName: string | null;
  /** Vendas do dia (número real do fornecedor). */
  salesDaily: number;
  /** Receita do dia em BRL (número real do fornecedor). */
  revenueDaily: number;
  tiktokUrl: string | null;
}

/**
 * Conector genérico de fornecedor de dados — configurável 100% por env:
 *
 *   EXTERNAL_DATA_URL=https://api.fornecedor.com/v1/products/top?region=BR
 *   EXTERNAL_DATA_API_KEY=...
 *   EXTERNAL_DATA_AUTH_HEADER=Authorization        (default)
 *   EXTERNAL_DATA_AUTH_PREFIX=Bearer               (default)
 *
 * A resposta esperada é um JSON com uma lista de produtos (em `data`, `list`,
 * `items` ou na raiz). O mapeamento de campos é defensivo, cobrindo os nomes
 * usados pelos fornecedores mais comuns. Sem as envs, o conector fica
 * desativado e a ingestão usa só o Creative Center.
 */
@Injectable()
export class ExternalDataProvider {
  private readonly logger = new Logger(ExternalDataProvider.name);
  private readonly url: string;
  private readonly apiKey: string;
  private readonly authHeader: string;
  private readonly authPrefix: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>('EXTERNAL_DATA_URL') ?? '';
    this.apiKey = config.get<string>('EXTERNAL_DATA_API_KEY') ?? '';
    this.authHeader =
      config.get<string>('EXTERNAL_DATA_AUTH_HEADER') ?? 'Authorization';
    this.authPrefix = config.get<string>('EXTERNAL_DATA_AUTH_PREFIX') ?? 'Bearer';
  }

  get enabled(): boolean {
    return this.url.length > 0 && this.apiKey.length > 0;
  }

  async fetchTopProducts(limit = 50): Promise<ExternalProduct[]> {
    if (!this.enabled) return [];
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        [this.authHeader]: this.authPrefix
          ? `${this.authPrefix} ${this.apiKey}`
          : this.apiKey,
      };
      const response = await fetch(this.url, { headers });
      if (!response.ok) {
        this.logger.warn(`Fornecedor externo respondeu ${response.status}`);
        return [];
      }
      const body = (await response.json()) as unknown;
      const list = this.extractList(body).slice(0, limit);
      return list
        .map((item, i) => this.parseItem(item, i))
        .filter((p): p is ExternalProduct => p !== null);
    } catch (error) {
      this.logger.warn(`Fornecedor externo falhou: ${error}`);
      return [];
    }
  }

  private extractList(body: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const obj = body as Record<string, unknown>;
    for (const key of ['data', 'list', 'items', 'products', 'results']) {
      const value = obj?.[key];
      if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
      const nested = (value as Record<string, unknown>)?.list;
      if (Array.isArray(nested)) return nested as Array<Record<string, unknown>>;
    }
    return [];
  }

  private parseItem(
    item: Record<string, unknown>,
    index: number,
  ): ExternalProduct | null {
    const title =
      (item.title as string) ??
      (item.product_name as string) ??
      (item.name as string);
    if (!title) return null;
    const id =
      (item.product_id as string) ?? (item.id as string) ?? `${index}-${title}`;
    return {
      externalId: `ext-${String(id).slice(0, 60)}`,
      title,
      category:
        (item.category as string) ??
        (item.category_name as string) ??
        'geral',
      price: Number(item.price ?? item.avg_price ?? 0) || 0,
      imageUrl:
        (item.image_url as string) ?? (item.cover_url as string) ?? null,
      storeName:
        (item.shop_name as string) ?? (item.store_name as string) ?? null,
      salesDaily: Number(item.sales ?? item.sold_count ?? item.sales_daily ?? 0),
      revenueDaily: Number(
        item.revenue ?? item.gmv ?? item.revenue_daily ?? 0,
      ),
      tiktokUrl: (item.url as string) ?? (item.product_url as string) ?? null,
    };
  }
}
