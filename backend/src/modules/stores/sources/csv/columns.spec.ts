import {
  mapHeader,
  normalizeHeader,
  ORDER_COLUMNS,
  parseDate,
  parseInteger,
  parseMoney,
} from './columns';
import { parseCsv } from './csv';

describe('normalizeHeader', () => {
  it('ignora acento, caixa e pontuação', () => {
    expect(normalizeHeader('Comissão')).toBe('comissao');
    expect(normalizeHeader('SKU Subtotal After Discount')).toBe(
      'skusubtotalafterdiscount',
    );
    expect(normalizeHeader('sku_subtotal_after_discount')).toBe(
      'skusubtotalafterdiscount',
    );
  });
});

describe('parseMoney', () => {
  it('lê o formato brasileiro', () => {
    expect(parseMoney('R$ 1.234,56')).toBe(1234.56);
    expect(parseMoney('39,90')).toBe(39.9);
  });

  it('lê o formato americano', () => {
    expect(parseMoney('$1,234.56')).toBe(1234.56);
    expect(parseMoney('12.00')).toBe(12);
  });

  it('trata separador de milhar sem decimais', () => {
    expect(parseMoney('1.234')).toBe(1234);
    expect(parseMoney('1,234')).toBe(1234);
  });

  it('preserva o sinal negativo das taxas', () => {
    expect(parseMoney('-R$ 12,30')).toBe(-12.3);
  });

  it('devolve zero para vazio e traço', () => {
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('-')).toBe(0);
    expect(parseMoney('N/A')).toBe(0);
  });
});

describe('parseInteger', () => {
  it('arredonda quantidades', () => {
    expect(parseInteger('3')).toBe(3);
    expect(parseInteger('2,0')).toBe(2);
    expect(parseInteger('')).toBe(0);
  });
});

describe('parseDate', () => {
  it('lê ISO com e sem hora', () => {
    expect(parseDate('2024-05-01')?.toISOString()).toBe(
      '2024-05-01T00:00:00.000Z',
    );
    expect(parseDate('2024-05-01 13:22:10')?.toISOString()).toBe(
      '2024-05-01T13:22:10.000Z',
    );
  });

  it('usa dia/mês por padrão (pt-BR)', () => {
    expect(parseDate('05/01/2024')?.toISOString()).toBe(
      '2024-01-05T00:00:00.000Z',
    );
  });

  it('respeita mdy quando a loja está configurada assim', () => {
    expect(parseDate('05/01/2024', 'mdy')?.toISOString()).toBe(
      '2024-05-01T00:00:00.000Z',
    );
  });

  it('resolve sozinho quando o dia é maior que 12', () => {
    expect(parseDate('25/12/2024', 'mdy')?.toISOString()).toBe(
      '2024-12-25T00:00:00.000Z',
    );
  });

  it('devolve null para lixo', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('sem data')).toBeNull();
  });
});

describe('mapHeader', () => {
  it('acha o cabeçalho mesmo com preâmbulo antes', () => {
    const rows = parseCsv(
      [
        'Relatório de pedidos',
        'Período: 01/05/2024 - 31/05/2024',
        'Order ID,Order Status,Created Time,Quantity,Seller SKU',
        '123,Shipped,01/05/2024,2,SKU-1',
      ].join('\n'),
    );
    const header = mapHeader(rows, ORDER_COLUMNS);
    expect(header).not.toBeNull();
    expect(header!.rowIndex).toBe(2);
    expect(header!.index.externalId).toBe(0);
    expect(header!.index.itemSku).toBe(4);
  });

  it('devolve null quando o arquivo não é o relatório esperado', () => {
    const rows = parseCsv('coluna a,coluna b\n1,2');
    expect(mapHeader(rows, ORDER_COLUMNS)).toBeNull();
  });
});
