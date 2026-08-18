import { aplicarPeriodo, MetricasPorPeriodo } from './ingestion.service';

/**
 * A regra de escrita das janelas.
 *
 * O que estes testes protegem é a decisão de NÃO gravar zero — a única que
 * separa "o ranking se mantém" de "o ranking se apaga sozinho entre duas
 * execuções". Ela não é óbvia lendo o código, então precisa estar amarrada.
 */
describe('aplicarPeriodo', () => {
  const produtoCom = (sales30d: number, revenue30d: string) => ({
    sales7d: 10,
    sales30d,
    sales60d: 200,
    sales90d: 300,
    revenue7d: '100.00',
    revenue30d,
    revenue60d: '2000.00',
    revenue90d: '3000.00',
  });

  const vindo = (p: Partial<MetricasPorPeriodo>): MetricasPorPeriodo => ({
    sales7d: 0,
    sales30d: 0,
    sales60d: 0,
    sales90d: 0,
    revenue7d: 0,
    revenue30d: 0,
    revenue60d: 0,
    revenue90d: 0,
    ...p,
  });

  it('grava o que veio com valor', () => {
    const p = produtoCom(100, '1000.00');
    aplicarPeriodo(p, vindo({ sales30d: 4283, revenue30d: 196385.04 }));
    expect(p.sales30d).toBe(4283);
    expect(p.revenue30d).toBe('196385.04');
  });

  /*
   * O caso real que motivou a regra: no arquivo bruto, o `product/detail`
   * devolveu 1d/7d/15d zerados e 30d/60d/90d preenchidos para o mesmo produto
   * que o `product/list` trouxe completo. Zero ali é "não calculei".
   */
  it('preserva o valor anterior quando a janela vem zerada', () => {
    const p = produtoCom(4283, '196385.04');
    aplicarPeriodo(p, vindo({ sales60d: 7453, revenue60d: 333595.64 }));
    expect(p.sales30d).toBe(4283);
    expect(p.revenue30d).toBe('196385.04');
    expect(p.sales7d).toBe(10);
    // …e o que veio com número entrou normalmente.
    expect(p.sales60d).toBe(7453);
  });

  it('não deixa uma resposta toda zerada apagar o produto do ranking', () => {
    const p = produtoCom(51461, '7804524.80');
    aplicarPeriodo(p, vindo({}));
    expect(p.sales30d).toBe(51461);
    expect(p.revenue30d).toBe('7804524.80');
  });

  it('preenche o produto que nasceu zerado', () => {
    const p = produtoCom(0, '0.00');
    p.sales7d = 0;
    p.sales60d = 0;
    p.sales90d = 0;
    aplicarPeriodo(
      p,
      vindo({ sales7d: 936, sales30d: 4283, sales60d: 7453, sales90d: 10914 }),
    );
    expect([p.sales7d, p.sales30d, p.sales60d, p.sales90d]).toEqual([
      936, 4283, 7453, 10914,
    ]);
  });

  it('arredonda a receita em duas casas, como a coluna numeric(14,2)', () => {
    const p = produtoCom(1, '0.00');
    aplicarPeriodo(p, vindo({ revenue30d: 81704.666 }));
    expect(p.revenue30d).toBe('81704.67');
  });
});
