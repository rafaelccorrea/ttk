import { Injectable } from '@nestjs/common';
import { decimal, toCsv } from './sources/csv/csv-writer';
import { StoresAnalyticsService } from './stores-analytics.service';
import { StoresService } from './stores.service';

export interface ExportFile {
  fileName: string;
  content: string;
}

/** Limite por exportação — evita segurar a API gerando arquivos gigantes. */
const MAX_ROWS = 5000;

const STAGE_LABEL: Record<string, string> = {
  pendente: 'A enviar',
  enviado: 'Enviado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

/**
 * Exportação dos relatórios da plataforma. O seller precisa levar esses
 * números para o contador ou para o sócio — sem isso o trabalho fica preso aqui.
 */
@Injectable()
export class StoresExportService {
  constructor(
    private readonly stores: StoresService,
    private readonly analytics: StoresAnalyticsService,
  ) {}

  private stamp(name: string, storeName: string): string {
    const slug = storeName
      .normalize('NFD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${slug || 'loja'}-${name}.csv`;
  }

  async products(userId: string, storeId: string): Promise<ExportFile> {
    const store = await this.stores.owned(userId, storeId);
    const { items } = await this.stores.listProducts(userId, storeId, {
      limit: MAX_ROWS,
      page: 1,
    });

    return {
      fileName: this.stamp('produtos', store.name),
      content: toCsv(items, [
        { header: 'SKU', value: (row) => row.sku },
        { header: 'Produto', value: (row) => row.title },
        { header: 'Categoria', value: (row) => row.category },
        { header: 'Preço', value: (row) => decimal(row.price) },
        { header: 'Custo', value: (row) => decimal(row.cost) },
        { header: 'Lucro por unidade', value: (row) => decimal(row.netProfit) },
        { header: 'Margem %', value: (row) => decimal(row.marginPct) },
        { header: 'Estoque', value: (row) => row.stock },
        { header: 'Alerta de estoque', value: (row) => row.stockAlert },
        { header: 'Status', value: (row) => row.status },
      ]),
    };
  }

  async skus(
    userId: string,
    storeId: string,
    period: number,
  ): Promise<ExportFile> {
    const store = await this.stores.owned(userId, storeId);
    const rows = await this.analytics.skuPerformance(userId, storeId, period);

    return {
      fileName: this.stamp(`curva-abc-${period}d`, store.name),
      content: toCsv(rows.slice(0, MAX_ROWS), [
        { header: 'Curva', value: (row) => row.curve },
        { header: 'SKU', value: (row) => row.sku },
        { header: 'Produto', value: (row) => row.title },
        { header: 'Unidades vendidas', value: (row) => row.units },
        { header: 'Faturamento', value: (row) => decimal(row.revenue) },
        { header: 'Custo dos produtos', value: (row) => decimal(row.cost) },
        { header: 'Lucro', value: (row) => decimal(row.profit) },
        { header: 'Margem %', value: (row) => decimal(row.marginPct) },
        { header: '% do faturamento', value: (row) => decimal(row.sharePct) },
        { header: 'Estoque atual', value: (row) => row.stock },
      ]),
    };
  }

  async orders(
    userId: string,
    storeId: string,
    period: number,
  ): Promise<ExportFile> {
    const store = await this.stores.owned(userId, storeId);
    const { items } = await this.stores.listOrders(userId, storeId, {
      period,
      limit: MAX_ROWS,
      page: 1,
    });

    const date = (value: Date | string | null) =>
      value ? new Date(value).toLocaleDateString('pt-BR') : '';

    return {
      fileName: this.stamp(`pedidos-${period}d`, store.name),
      content: toCsv(items, [
        { header: 'Pedido', value: (row) => row.externalId },
        { header: 'Data', value: (row) => date(row.placedAt) },
        { header: 'Status', value: (row) => STAGE_LABEL[row.stage] ?? row.stage },
        { header: 'Status original', value: (row) => row.status },
        { header: 'Valor', value: (row) => decimal(row.grossAmount) },
        { header: 'Frete', value: (row) => decimal(row.shippingFee) },
        { header: 'Desconto', value: (row) => decimal(row.discount) },
        {
          header: 'Itens',
          value: (row) =>
            row.items
              .map((item) => `${item.quantity}x ${item.sku}`)
              .join(' | '),
        },
        { header: 'Transportadora', value: (row) => row.shippingProvider },
        { header: 'Rastreio', value: (row) => row.trackingCode },
        { header: 'Enviar até', value: (row) => date(row.shipBy) },
        { header: 'Atrasado', value: (row) => (row.late ? 'Sim' : 'Não') },
      ]),
    };
  }
}
