/**
 * Formatação de números para leitor brasileiro.
 *
 * A versão anterior montava a abreviação à mão com `toFixed(1)` e sufixo K/M.
 * Dois erros num só lugar: o `toFixed` usa PONTO como separador decimal, então
 * a tela mostrava "R$ 836.0K" — que um brasileiro lê como oitocentos e trinta
 * e seis reais; e "K"/"M" são abreviações inglesas. O produto inteiro é em
 * pt-BR e esses números são o argumento de venda da plataforma, então ler
 * errado o faturamento de um produto é o pior lugar possível para essa falha.
 *
 * O `Intl` resolve os dois de uma vez: em pt-BR, `notation: 'compact'` produz
 * "836,4 mil" e "7,8 mi", com a vírgula certa.
 */

const compacto = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const compactoBRL = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
  style: 'currency',
  currency: 'BRL',
});

const exato = new Intl.NumberFormat('pt-BR');

/**
 * Valor abreviado — para cards e rankings, onde o que importa é a ordem de
 * grandeza. Abaixo de mil não abrevia: "R$ 26,96" é mais útil que "R$ 27".
 */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1_000) return formatMoney(value);
  return compactoBRL.format(value);
}

/** Valor exato — para tabelas de pedidos, custo e margem, onde "1,2 mil" não serve. */
export function formatMoney(value: number, currency = 'BRL'): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency });
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  // Contagens pequenas saem inteiras: "362 views", não "362".
  if (Math.abs(value) < 1_000) return exato.format(value);
  return compacto.format(value);
}
