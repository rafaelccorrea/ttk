/**
 * Um número de vendas/visualizações vira um piso, não o valor exato:
 * "25.317" → "25 mil+".
 *
 * Mora no `common` porque duas superfícies dependem exatamente da mesma régua —
 * a vitrine pública da landing (`ShowcaseService`) e a amostra da conta gratuita
 * (`FreeSampleService`). Se as duas tivessem cada uma a sua cópia, bastaria
 * alguém afinar uma delas para que o mesmo produto aparecesse com duas ordens de
 * grandeza diferentes em duas telas do mesmo site.
 *
 * A primeira versão arredondava para a potência de 10 abaixo, e o resultado na
 * tela foi oito cards dizendo "10.000+ vendas" — como a amostra é o topo do
 * ranking, todo mundo caía no mesmo balde e a seção não provava nada. Piso no
 * milhar mantém o número exato escondido (que é o que se vende) e devolve a
 * diferença entre um produto de 25 mil e um de 90 mil, que é justamente o que
 * faz o visitante querer ver a lista inteira.
 *
 * A faixa de milhão existe porque a régua nasceu para VENDAS e passou a ser
 * usada também para VISUALIZAÇÕES de vídeo, que são uma ordem de grandeza
 * acima: um vídeo com 38 milhões de views virava "38.385 mil+" na tela — um
 * número que o leitor tem de converter de cabeça, no lugar exato onde a
 * amostra deveria impressionar.
 */
export function toRange(value: number): string {
  if (!value || value < 100) return '<100';
  if (value < 1000) return `${Math.floor(value / 100) * 100}+`;
  if (value < 1_000_000) {
    return `${Math.floor(value / 1000).toLocaleString('pt-BR')} mil+`;
  }
  return `${Math.floor(value / 1_000_000).toLocaleString('pt-BR')} mi+`;
}
