import { BadRequestException } from '@nestjs/common';
import {
  ImportIssue,
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedProduct,
  NormalizedSettlement,
  StoreDataset,
  StoreSyncSource,
  SyncContext,
  SyncResult,
} from '../store-sync-source';
import {
  cell,
  ColumnSpec,
  DateOrder,
  HeaderMap,
  mapHeader,
  ORDER_COLUMNS,
  parseDate,
  parseInteger,
  parseMoney,
  PRODUCT_COLUMNS,
  SETTLEMENT_COLUMNS,
} from './columns';
import { CsvRow } from './csv';
import { readSpreadsheet, SpreadsheetFormat } from './spreadsheet';

/**
 * Fonte de dados por planilha exportada do Seller Center (CSV ou XLSX).
 *
 * É a única fonte que funciona em produção hoje sem app homologado na TikTok:
 * o seller exporta Pedidos / Produtos / Repasses e sobe o arquivo aqui.
 */
export class SpreadsheetImportSource implements StoreSyncSource {
  /**
   * Identifica a fonte como "arquivo enviado pelo usuário". O valor continua
   * `csv` por compatibilidade com os registros de importação já gravados; o
   * formato real de cada arquivo é reportado em `SyncResult.format`.
   */
  readonly kind = 'csv' as const;

  constructor(private readonly dateOrder: DateOrder = 'dmy') {}

  supports(_dataset: StoreDataset): boolean {
    return true;
  }

  // ------------------------------------------------------------------ Produtos

  async products(ctx: SyncContext): Promise<SyncResult<NormalizedProduct>> {
    const { rows, header, issues, format } = await this.open(
      ctx,
      PRODUCT_COLUMNS,
      'produtos',
    );
    const out: NormalizedProduct[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const sku = cell(row, header, 'sku') || cell(row, header, 'externalId');
      if (!sku) {
        issues.push({ line: row.line, message: 'Linha sem SKU — ignorada.' });
        continue;
      }
      if (seen.has(sku)) continue; // a planilha repete o produto por variação
      seen.add(sku);

      const title = cell(row, header, 'title');
      if (!title) {
        issues.push({
          line: row.line,
          message: `SKU ${sku} sem nome de produto — ignorado.`,
        });
        continue;
      }

      const priceRaw = cell(row, header, 'price');
      const stockRaw = cell(row, header, 'stock');
      out.push({
        externalId: cell(row, header, 'externalId') || null,
        sku,
        title,
        category: cell(row, header, 'category') || null,
        price: priceRaw ? parseMoney(priceRaw) : null,
        stock: stockRaw ? parseInteger(stockRaw) : null,
        status: cell(row, header, 'status') || null,
        imageUrl: cell(row, header, 'imageUrl') || null,
      });
    }

    return { rows: out, issues, rowsRead: rows.length, format };
  }

  // ------------------------------------------------------------------- Pedidos

  async orders(ctx: SyncContext): Promise<SyncResult<NormalizedOrder>> {
    const { rows, header, issues, format } = await this.open(
      ctx,
      ORDER_COLUMNS,
      'pedidos',
    );

    // O relatório traz uma linha por SKU: agrupamos de volta em pedidos.
    const byOrder = new Map<string, NormalizedOrder>();

    for (const row of rows) {
      const externalId = cell(row, header, 'externalId');
      if (!externalId) {
        issues.push({
          line: row.line,
          message: 'Linha sem número de pedido — ignorada.',
        });
        continue;
      }

      const placedAt = parseDate(cell(row, header, 'placedAt'), this.dateOrder);
      if (!placedAt) {
        issues.push({
          line: row.line,
          message: `Pedido ${externalId} sem data de criação válida — ignorado.`,
        });
        continue;
      }

      let order = byOrder.get(externalId);
      if (!order) {
        order = {
          externalId,
          placedAt,
          status: cell(row, header, 'status') || 'desconhecido',
          shipBy: parseDate(cell(row, header, 'shipBy'), this.dateOrder),
          shippedAt: parseDate(cell(row, header, 'shippedAt'), this.dateOrder),
          shippingProvider: cell(row, header, 'shippingProvider') || null,
          trackingCode: cell(row, header, 'trackingCode') || null,
          grossAmount: parseMoney(cell(row, header, 'orderAmount')),
          shippingFee: parseMoney(cell(row, header, 'shippingFee')),
          discount: parseMoney(cell(row, header, 'orderDiscount')),
          currency: cell(row, header, 'currency') || null,
          items: [],
        };
        byOrder.set(externalId, order);
      }

      const item = this.readItem(row, header);
      if (item) order.items.push(item);
    }

    // Quando o relatório não traz o total do pedido, somamos os itens.
    for (const order of byOrder.values()) {
      if (order.grossAmount === 0 && order.items.length > 0) {
        order.grossAmount = order.items.reduce(
          (acc, item) => acc + item.subtotal,
          0,
        );
      }
    }

    return {
      rows: [...byOrder.values()],
      issues,
      rowsRead: rows.length,
      format,
    };
  }

  private readItem(
    row: CsvRow,
    header: HeaderMap,
  ): NormalizedOrderItem | null {
    const sku = cell(row, header, 'itemSku');
    if (!sku) return null;

    const quantity = parseInteger(cell(row, header, 'itemQuantity')) || 1;
    const unitPrice = parseMoney(cell(row, header, 'itemUnitPrice'));
    const discount = parseMoney(cell(row, header, 'itemDiscount'));
    const subtotalRaw = cell(row, header, 'itemSubtotal');
    const subtotal = subtotalRaw
      ? parseMoney(subtotalRaw)
      : unitPrice * quantity - discount;

    return {
      sku,
      title: cell(row, header, 'itemTitle') || null,
      quantity,
      unitPrice,
      discount,
      subtotal,
    };
  }

  // ------------------------------------------------------------------ Repasses

  async settlements(ctx: SyncContext): Promise<SyncResult<NormalizedSettlement>> {
    const { rows, header, issues, format } = await this.open(
      ctx,
      SETTLEMENT_COLUMNS,
      'repasses',
    );
    const out: NormalizedSettlement[] = [];

    for (const row of rows) {
      const externalOrderId = cell(row, header, 'externalOrderId');
      if (!externalOrderId) {
        issues.push({
          line: row.line,
          message: 'Linha sem pedido de referência — ignorada.',
        });
        continue;
      }

      // As taxas saem negativas no extrato; guardamos como custo positivo.
      const fee = (field: string) =>
        Math.abs(parseMoney(cell(row, header, field)));

      out.push({
        externalOrderId,
        settledAt: parseDate(cell(row, header, 'settledAt'), this.dateOrder),
        grossAmount: parseMoney(cell(row, header, 'grossAmount')),
        platformFee: fee('platformFee'),
        commissionFee: fee('commissionFee'),
        affiliateFee: fee('affiliateFee'),
        shippingFee: fee('shippingFee'),
        otherFees: fee('otherFees'),
        netAmount: parseMoney(cell(row, header, 'netAmount')),
        currency: cell(row, header, 'currency') || null,
      });
    }

    return { rows: out, issues, rowsRead: rows.length };
  }

  // -------------------------------------------------------------------- Comum

  private async open(
    ctx: SyncContext,
    spec: ColumnSpec,
    label: string,
  ): Promise<{
    rows: CsvRow[];
    header: HeaderMap;
    issues: ImportIssue[];
    format: SpreadsheetFormat;
  }> {
    if (!ctx.file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }

    const { rows: parsed, format } = await readSpreadsheet(ctx.file.buffer);
    if (parsed.length === 0) {
      throw new BadRequestException('O arquivo está vazio.');
    }

    const header = mapHeader(parsed, spec);
    if (!header) {
      throw new BadRequestException(
        `Não reconhecemos as colunas de um relatório de ${label}. Envie a planilha exportada pelo Seller Center sem alterar o cabeçalho.`,
      );
    }

    return {
      rows: parsed.slice(header.rowIndex + 1),
      header,
      issues: [],
      format,
    };
  }
}
