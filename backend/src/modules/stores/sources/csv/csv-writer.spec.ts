import { decimal, toCsv } from './csv-writer';
import { parseCsv } from './csv';

describe('toCsv', () => {
  const rows = [{ sku: 'SKU-A', title: 'Camiseta', price: 49.9 }];

  it('escreve cabeçalho e linhas separados por ponto e vírgula', () => {
    const csv = toCsv(rows, [
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Produto', value: (r) => r.title },
    ]);
    expect(csv).toContain('SKU;Produto');
    expect(csv).toContain('SKU-A;Camiseta');
  });

  it('começa com BOM para o Excel não corromper acentos', () => {
    const csv = toCsv([{ t: 'Boné Trucker' }], [
      { header: 'Título', value: (r) => r.t },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('protege valores que contêm o separador ou aspas', () => {
    const csv = toCsv(
      [{ t: 'Camiseta "Oversized"; azul' }],
      [{ header: 'Produto', value: (r) => r.t }],
    );
    expect(csv).toContain('"Camiseta ""Oversized""; azul"');
  });

  it('deixa vazio o que é nulo, em vez de escrever "null"', () => {
    const csv = toCsv(
      [{ a: null as string | null, b: undefined as string | undefined }],
      [
        { header: 'A', value: (r) => r.a },
        { header: 'B', value: (r) => r.b },
      ],
    );
    expect(csv.split('\r\n')[1]).toBe(';');
  });

  it('gera arquivo que o próprio parser de importação relê', () => {
    const csv = toCsv(rows, [
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Produto', value: (r) => r.title },
      { header: 'Preço', value: (r) => decimal(r.price) },
    ]);

    const parsed = parseCsv(csv);
    expect(parsed[0].cells).toEqual(['SKU', 'Produto', 'Preço']);
    expect(parsed[1].cells).toEqual(['SKU-A', 'Camiseta', '49,90']);
  });
});

describe('decimal', () => {
  it('usa vírgula decimal com duas casas', () => {
    expect(decimal(1234.5)).toBe('1234,50');
    expect(decimal(0)).toBe('0,00');
  });

  it('preserva o sinal negativo', () => {
    expect(decimal(-17)).toBe('-17,00');
  });

  it('devolve vazio para ausência de valor', () => {
    expect(decimal(null)).toBe('');
    expect(decimal(undefined)).toBe('');
  });
});
