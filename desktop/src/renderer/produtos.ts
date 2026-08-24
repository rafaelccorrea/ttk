/**
 * Ajudantes da lista de "fixar produto" do cockpit — puros, para o teste.
 */

/**
 * A inicial que vai no lugar da foto quando o produto não tem uma.
 *
 * Só a primeira letra de verdade: "Kit Glow" vira "K" e "  o kit rosa" vira
 * "O". Sem nome, um "?" — a linha nunca fica com um quadrado vazio.
 */
export function iniciaisDe(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) return '?';
  const letra = limpo.charAt(0).toUpperCase();
  return /[\p{L}\p{N}]/u.test(letra) ? letra : '?';
}

/**
 * Preço em reais, no formato que o vendedor lê ("R$ 89,90"), ou "sem preço".
 *
 * Formatação à mão, e não `Intl.NumberFormat`: a saída do Intl varia com o
 * espaço (fino ou comum) entre "R$" e o número conforme a versão do ICU do
 * Electron — um teste que compara texto ficaria refém disso.
 */
export function formatarPrecoBrl(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return 'sem preço';
  const [inteiro, centavos] = Math.abs(valor).toFixed(2).split('.');
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${valor < 0 ? '-' : ''}R$ ${comMilhar},${centavos}`;
}

/**
 * A chave de busca da lista de produtos: sem acento, sem caixa, sem espaço
 * sobrando. O vendedor digita "creme" no meio da live e precisa achar
 * "Crème Hidratante" — a busca exata deixaria a lista vazia por um til.
 */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
