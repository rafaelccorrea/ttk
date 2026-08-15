/**
 * Mapeamento de cabeçalhos e coerção de valores dos relatórios do Seller Center.
 *
 * Os nomes de coluna mudam por região e por versão do painel, então cada campo
 * lógico tem uma lista de apelidos (inglês e português). O casamento é feito
 * sobre o cabeçalho normalizado — sem acento, sem pontuação, minúsculo — para
 * que "SKU Subtotal After Discount" e "sku_subtotal_after_discount" caiam no
 * mesmo lugar.
 */

import { CsvRow } from './csv';

export function normalizeHeader(header: string): string {
  // NFD separa o acento em marca combinante (U+0300–U+036F); o filtro de
  // [^a-z0-9] logo abaixo já as remove junto com espaços e pontuação.
  return header
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// ------------------------------------------------------------------- Apelidos

export const PRODUCT_COLUMNS = {
  externalId: ['product id', 'id do produto', 'productid'],
  sku: ['seller sku', 'sku do vendedor', 'sku id', 'id do sku', 'sku', 'codigo'],
  title: ['product name', 'nome do produto', 'produto', 'title'],
  category: ['category', 'categoria', 'category name'],
  price: ['retail price', 'preco', 'preco de varejo', 'price', 'sku retail price'],
  stock: ['quantity', 'stock', 'estoque', 'quantidade', 'available quantity'],
  status: ['status', 'product status', 'status do produto'],
  imageUrl: ['main image', 'imagem', 'image url', 'imagem principal'],
} as const;

export const ORDER_COLUMNS = {
  externalId: ['order id', 'id do pedido', 'orderid', 'numero do pedido'],
  status: ['order status', 'status do pedido', 'status'],
  placedAt: ['created time', 'data de criacao', 'order create time', 'criado em'],
  shipBy: ['ship by', 'shipping deadline', 'prazo de envio', 'enviar ate'],
  shippedAt: ['shipped time', 'data de envio', 'enviado em'],
  shippingProvider: ['shipping provider name', 'transportadora', 'shipping provider'],
  trackingCode: ['tracking id', 'codigo de rastreio', 'tracking number'],
  currency: ['currency', 'moeda'],
  orderAmount: ['order amount', 'valor do pedido', 'total amount'],
  shippingFee: [
    'shipping fee after discount',
    'frete',
    'shipping fee',
    'taxa de envio',
  ],
  orderDiscount: ['payment platform discount', 'desconto', 'seller discount'],
  // Itens (o relatório de pedidos vem com uma linha por SKU)
  itemSku: ['seller sku', 'sku do vendedor', 'sku id', 'id do sku', 'sku'],
  itemTitle: ['product name', 'nome do produto', 'produto'],
  itemQuantity: ['quantity', 'quantidade', 'qty'],
  itemUnitPrice: [
    'sku unit original price',
    'preco unitario',
    'unit price',
    'sku original price',
  ],
  itemSubtotal: [
    'sku subtotal after discount',
    'subtotal',
    'sku subtotal before discount',
  ],
  itemDiscount: ['sku seller discount', 'desconto do item', 'sku platform discount'],
} as const;

export const SETTLEMENT_COLUMNS = {
  externalOrderId: [
    'order adjustment id',
    'orderadjustment id',
    'order id',
    'id do pedido',
    'related order id',
  ],
  settledAt: [
    'order settled time',
    'statement time',
    'data de repasse',
    'settlement time',
  ],
  grossAmount: ['total revenue', 'receita total', 'revenue', 'gross amount'],
  platformFee: ['transaction fee', 'taxa de transacao', 'platform fee'],
  commissionFee: [
    'tiktok shop commission fee',
    'tiktok shop commission',
    'comissao',
    'commission',
  ],
  affiliateFee: [
    'affiliate commission',
    'comissao de afiliado',
    'affiliate partner commission',
  ],
  shippingFee: ['actual shipping fee', 'frete', 'shipping cost'],
  otherFees: ['total fees', 'taxas totais', 'other fees'],
  netAmount: [
    'total settlement amount',
    'settlement amount',
    'valor liquido',
    'net amount',
  ],
  currency: ['currency', 'moeda'],
} as const;

export type ColumnSpec = Record<string, readonly string[]>;

// ------------------------------------------------------------------ Cabeçalho

export interface HeaderMap {
  /** campo lógico -> índice da coluna no CSV */
  index: Record<string, number>;
  /** Linha física onde o cabeçalho foi encontrado. */
  line: number;
  /** Índice do cabeçalho dentro do array de linhas. */
  rowIndex: number;
}

/**
 * Acha a linha de cabeçalho. Alguns relatórios trazem um preâmbulo (título do
 * relatório, período exportado) antes dos cabeçalhos de verdade, então varremos
 * as primeiras linhas e ficamos com a que casa mais campos conhecidos.
 */
export function mapHeader(
  rows: CsvRow[],
  spec: ColumnSpec,
  lookahead = 10,
): HeaderMap | null {
  let best: HeaderMap | null = null;
  let bestScore = 0;

  const limit = Math.min(rows.length, lookahead);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const normalized = rows[rowIndex].cells.map(normalizeHeader);
    const index: Record<string, number> = {};

    for (const [field, aliases] of Object.entries(spec)) {
      for (const alias of aliases) {
        const at = normalized.indexOf(normalizeHeader(alias));
        if (at >= 0) {
          index[field] = at;
          break;
        }
      }
    }

    const score = Object.keys(index).length;
    if (score > bestScore) {
      bestScore = score;
      best = { index, line: rows[rowIndex].line, rowIndex };
    }
  }

  // Menos de dois campos reconhecidos = não é o relatório que esperávamos.
  return bestScore >= 2 ? best : null;
}

export function cell(row: CsvRow, header: HeaderMap, field: string): string {
  const at = header.index[field];
  if (at === undefined) return '';
  return row.cells[at] ?? '';
}

// -------------------------------------------------------------------- Coerção

/**
 * Converte o dinheiro como ele sai dos relatórios: "R$ 1.234,56", "1,234.56",
 * "US$ 12.00", "-", "" ou já numérico. Retorna 0 quando não há valor.
 */
export function parseMoney(raw: string): number {
  if (!raw) return 0;
  let text = raw.replace(/[^\d,.\-]/g, '').trim();
  if (!text || text === '-') return 0;

  const negative = text.startsWith('-');
  if (negative) text = text.slice(1);

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // O separador decimal é o que aparece por último.
    const decimalAt = Math.max(lastComma, lastDot);
    const thousandsSep = decimalAt === lastComma ? '.' : ',';
    text =
      text.slice(0, decimalAt).split(thousandsSep).join('') +
      '.' +
      text.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    // Só vírgula: decimal se sobram 1-2 dígitos ("1.234,5"); senão, milhar.
    const decimals = text.length - lastComma - 1;
    text =
      decimals > 0 && decimals <= 2
        ? text.slice(0, lastComma) + '.' + text.slice(lastComma + 1)
        : text.split(',').join('');
  } else if (lastDot >= 0) {
    const decimals = text.length - lastDot - 1;
    if (decimals === 3 && /^\d{1,3}(\.\d{3})+$/.test(text)) {
      text = text.split('.').join(''); // "1.234" = mil e duzentos e trinta e quatro
    }
  }

  const value = Number(text);
  if (!Number.isFinite(value)) return 0;
  return negative ? -value : value;
}

export function parseInteger(raw: string): number {
  const value = Math.round(parseMoney(raw));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Datas dos relatórios: ISO, "DD/MM/YYYY HH:mm:ss" (pt-BR) ou "MM/DD/YYYY"
 * (en-US). Quando o primeiro componente é maior que 12 a ordem é inequívoca;
 * fora isso usamos `dateOrder`, que a loja define no cadastro.
 */
export type DateOrder = 'dmy' | 'mdy';

export function parseDate(raw: string, order: DateOrder = 'dmy'): Date | null {
  const text = raw.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(
    text,
  );
  if (iso) {
    return buildDate(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      iso[4],
      iso[5],
      iso[6],
    );
  }

  const slash =
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
      text,
    );
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;

    const dayFirst = first > 12 ? true : second > 12 ? false : order === 'dmy';
    const day = dayFirst ? first : second;
    const month = dayFirst ? second : first;
    return buildDate(year, month, day, slash[4], slash[5], slash[6]);
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function buildDate(
  year: number,
  month: number,
  day: number,
  hour?: string,
  minute?: string,
  second?: string,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      Number(hour ?? 0),
      Number(minute ?? 0),
      Number(second ?? 0),
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
