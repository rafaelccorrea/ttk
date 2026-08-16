import { Injectable } from '@nestjs/common';
import { ProductsService } from '../products/products.service';

/** Um produto como o visitante não logado vê: prova, não entrega. */
export interface ShowcaseProduct {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  price: number;
  /** Faixa de vendas ("1.000+"), nunca o número exato. */
  salesRange: string;
  /** Crescimento no período, arredondado para inteiro. */
  growthPct: number | null;
}

export interface ShowcaseSnapshot {
  products: ShowcaseProduct[];
  /** Números da base inteira — o tamanho do que está atrás do paywall. */
  stats: { products: number; categories: number };
  /** Defasagem anunciada da amostra, em dias. */
  delayDays: number;
}

/**
 * Vitrine pública da landing: o que substituiu a conta gratuita.
 *
 * O dilema era real — vender dado de mercado exige provar que o dado existe,
 * mas conta grátis com dado real é justamente o que destruía o produto (cada
 * consulta custa dinheiro no fornecedor, e quem já viu o ranking não precisa
 * assinar). A saída é mostrar QUE existe sem entregar o que ele vale:
 *
 *  - quantidade minúscula (8 produtos) e sem paginação, filtro ou busca;
 *  - o que é acionável fica de fora — nome da loja, link do TikTok, receita e
 *    a série diária. É por isso que se paga: para saber onde comprar e quanto
 *    aquilo fatura;
 *  - vendas em faixa, não em número — dá a ordem de grandeza sem virar planilha;
 *  - defasagem anunciada: a amostra não é o ranking de hoje, e isso é dito na
 *    tela em vez de escondido.
 *
 * O corte é de propósito generoso no visual e avaro no dado: quem chega vê a
 * plataforma real funcionando, e quem quer usar precisa assinar.
 */
@Injectable()
export class ShowcaseService {
  /** Quantos produtos a amostra mostra. */
  private static readonly SAMPLE_SIZE = 8;

  /** Defasagem anunciada da amostra. */
  private static readonly DELAY_DAYS = 7;

  /**
   * Cache de 1 hora. A landing é a página mais visitada e não tem login: sem
   * isto, cada visitante (e cada robô) viraria uma consulta de ranking no banco.
   * O TTL longo também reforça o produto — amostra defasada é o combinado.
   */
  private static readonly TTL_MS = 60 * 60 * 1000;
  private cache: { at: number; data: ShowcaseSnapshot } | null = null;

  constructor(private readonly products: ProductsService) {}

  async snapshot(): Promise<ShowcaseSnapshot> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < ShowcaseService.TTL_MS) {
      return this.cache.data;
    }
    const data = await this.build();
    this.cache = { at: now, data };
    return data;
  }

  private async build(): Promise<ShowcaseSnapshot> {
    const { items, total } = await this.products.rank({
      period: 30,
      page: 1,
      limit: ShowcaseService.SAMPLE_SIZE,
    });
    const categories = await this.products.categories();
    return {
      products: items.map((p) => ({
        id: p.id,
        title: p.title,
        category: p.category,
        imageUrl: p.imageUrl,
        price: p.price,
        salesRange: ShowcaseService.toRange(p.salesPeriod),
        growthPct: p.growthPct === null ? null : Math.round(p.growthPct),
      })),
      stats: { products: total, categories: categories.length },
      delayDays: ShowcaseService.DELAY_DAYS,
    };
  }

  /**
   * Vendas viram faixa pela potência de 10 abaixo do valor ("2.300" → "1.000+").
   * A ordem de grandeza é o que convence; o número exato é o que se vende.
   */
  private static toRange(sales: number): string {
    if (!sales || sales < 10) return '<10';
    const floor = Math.pow(10, Math.floor(Math.log10(sales)));
    return `${floor.toLocaleString('pt-BR')}+`;
  }
}
