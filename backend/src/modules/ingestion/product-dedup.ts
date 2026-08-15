/**
 * Deduplicação de produtos.
 *
 * O `product_id` da TikTok Shop é único por ANÚNCIO, não por produto. O mesmo
 * item aparece várias vezes porque:
 *  - vendedores diferentes anunciam o mesmo produto;
 *  - o mesmo vendedor cria anúncios por variação (2, 3, 5 unidades);
 *  - a descoberta por categoria e por página traz o item repetido.
 *
 * Resultado prático: a vitrine mostra "Kit 5 Conjuntos de Moletom Infantil"
 * cinco vezes seguidas, o que dá impressão de catálogo pobre.
 *
 * A estratégia aqui é conservadora: NÃO apagamos nada. Marcamos o duplicado e
 * escondemos das listagens, mantendo o registro para não perder histórico de
 * métricas nem quebrar favoritos já salvos.
 */

/** Palavras que só descrevem embalagem/variação — não identificam o produto. */
const RUIDO = new Set([
  'kit', 'kits', 'combo', 'conjunto', 'conjuntos', 'pack', 'unid', 'unidade',
  'unidades', 'pecas', 'peca', 'pcs', 'un', 'com', 'de', 'do', 'da', 'e', 'para',
  'the', 'o', 'a', 'os', 'as', 'em', 'por', 'sem',
]);

/** Quantas palavras significativas formam a assinatura. */
const PALAVRAS_CHAVE = 5;

/**
 * Assinatura normalizada do produto.
 *
 * Tira acento, pontuação, número e palavra de embalagem, e fica com as
 * primeiras palavras que realmente descrevem o item. "Kit 5 Conjuntos de
 * Moletom Infantil Bebê Menino" e "Kit 2 Conjuntos de Moletom Bebê Masculino"
 * colapsam em assinaturas próximas — mas não idênticas, porque "menino" e
 * "masculino" seguem diferentes. É proposital: preferimos deixar passar um
 * duplicado do que esconder um produto legítimo.
 */
export function dedupKey(title: string): string {
  const palavras = (title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !RUIDO.has(p) && !/^\d+$/.test(p));

  return palavras.slice(0, PALAVRAS_CHAVE).join('-');
}

export interface CandidatoDedup {
  id: string;
  title: string;
  /** Critério de desempate: quem vende mais é o canônico. */
  revenue: number;
}

/**
 * Decide quem fica visível em cada grupo de duplicados.
 *
 * Devolve os ids que devem ser MARCADOS como duplicata — ou seja, todos menos
 * o de maior receita de cada grupo.
 */
export function escolherDuplicados(itens: CandidatoDedup[]): string[] {
  const grupos = new Map<string, CandidatoDedup[]>();
  for (const item of itens) {
    const chave = dedupKey(item.title);
    // Assinatura muito curta não é confiável para agrupar.
    if (chave.split('-').length < 3) continue;
    const grupo = grupos.get(chave);
    if (grupo) grupo.push(item);
    else grupos.set(chave, [item]);
  }

  const duplicados: string[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const ordenado = [...grupo].sort((a, b) => b.revenue - a.revenue);
    // O primeiro (maior receita) permanece; o resto é escondido.
    duplicados.push(...ordenado.slice(1).map((x) => x.id));
  }
  return duplicados;
}
