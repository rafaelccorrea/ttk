/**
 * Portão de qualidade: decide se um candidato raspado é REALMENTE um produto.
 *
 * Regra de ouro do PikPok: é melhor não trazer nada do que trazer algo que
 * não é produto. Todo candidato precisa passar por aqui antes de virar linha
 * no banco, e todo motivo de recusa é registrado para podermos afinar.
 */

export interface ProductCandidate {
  title: string;
  /** Objetivo da campanha no TikTok (sinal estrutural mais forte). */
  objectiveKey?: string;
  category?: string | null;
  price?: number;
}

export interface GateResult {
  accepted: boolean;
  reason?: string;
  /** Título limpo, pronto para exibição. */
  cleanTitle?: string;
}

/** Só estes objetivos indicam anúncio que vende produto. */
const PRODUCT_OBJECTIVES = new Set([
  'campaign_objective_product_sales',
]);

/** Padrões que denunciam legenda/institucional em vez de produto. */
const REJECT_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /^#/, reason: 'começa com hashtag (legenda, não produto)' },
  { re: /#\w+\s*#\w+\s*#\w+/, reason: 'três ou mais hashtags seguidas' },
  { re: /\b(live|livehighlights|tiktoklive|fyp|foryou|viral)\b/i, reason: 'termo de conteúdo, não de produto' },
  { re: /\b(baixe o app|cadastre-se|inscreva|assine|agende|saiba mais|clique aqui)\b/i, reason: 'chamada institucional' },
  { re: /\b(curso|mentoria|consultoria|palestra|evento|ingresso|show|festival)\b/i, reason: 'serviço ou evento' },
  { re: /\b(vaga|contrat|emprego|franquia|invista|empréstimo|crédito|conta digital|seguro)\b/i, reason: 'serviço financeiro ou vaga' },
  { re: /\b(sorteio|giveaway|promoção do canal)\b/i, reason: 'promoção de canal' },
];

/** Só aceitamos títulos com cara de nome de produto. */
const MIN_LEN = 8;
const MAX_LEN = 90;

export function evaluateProduct(candidate: ProductCandidate): GateResult {
  const raw = (candidate.title ?? '').replace(/\s+/g, ' ').trim();

  // 1) Sinal estrutural: o TikTok precisa dizer que o anúncio vende produto.
  if (
    candidate.objectiveKey &&
    !PRODUCT_OBJECTIVES.has(candidate.objectiveKey)
  ) {
    return {
      accepted: false,
      reason: `objetivo "${candidate.objectiveKey.replace('campaign_objective_', '')}" não é venda de produto`,
    };
  }

  if (!raw) return { accepted: false, reason: 'título vazio' };

  // 2) Remove hashtags e menções do fim, que são ruído comum de legenda.
  const cleaned = raw
    .replace(/[#@][^\s#@]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < MIN_LEN) {
    return { accepted: false, reason: 'título curto demais após limpeza' };
  }
  if (cleaned.length > MAX_LEN) {
    return { accepted: false, reason: 'título longo demais (parece legenda)' };
  }

  // 3) Padrões de recusa.
  for (const { re, reason } of REJECT_PATTERNS) {
    if (re.test(raw)) return { accepted: false, reason };
  }

  // 4) Nome de produto é um sintagma curto, não uma frase. Legenda longa ou
  //    cheia de vírgulas é descrição, não nome — e vira lixo no catálogo.
  const words = cleaned.split(/\s+/);
  if (words.length > 10) {
    return { accepted: false, reason: `frase com ${words.length} palavras (legenda, não nome)` };
  }
  if ((cleaned.match(/,/g) ?? []).length >= 2) {
    return { accepted: false, reason: 'frase com múltiplas vírgulas (descrição)' };
  }

  // 5) Fora do mercado BR: alfabeto não latino ou anúncio claramente em inglês.
  if (/[Ѐ-ӿ؀-ۿ぀-ヿ一-鿿가-힯]/.test(raw)) {
    return { accepted: false, reason: 'idioma fora do mercado brasileiro' };
  }
  if (/\b(buy now|buy that|shop now|only \$|free shipping|starting at|order now)\b/i.test(raw)) {
    return { accepted: false, reason: 'anúncio em inglês (outro mercado)' };
  }

  // 6) Depoimento/legenda em 1ª pessoa não é nome de produto.
  if (/\b(eu |tenho amado|amei|comprei|testei|olha só|gente,|pov:)\b/i.test(cleaned)) {
    return { accepted: false, reason: 'depoimento pessoal, não nome de produto' };
  }

  return { accepted: true, cleanTitle: cleaned };
}

/** Aplica o portão em lote e devolve aprovados + relatório de recusas. */
export function filterProducts<T extends ProductCandidate>(
  candidates: T[],
): { accepted: Array<T & { cleanTitle: string }>; rejected: Array<{ title: string; reason: string }> } {
  const accepted: Array<T & { cleanTitle: string }> = [];
  const rejected: Array<{ title: string; reason: string }> = [];
  for (const candidate of candidates) {
    const result = evaluateProduct(candidate);
    if (result.accepted && result.cleanTitle) {
      accepted.push({ ...candidate, cleanTitle: result.cleanTitle });
    } else {
      rejected.push({
        title: (candidate.title ?? '').slice(0, 60),
        reason: result.reason ?? 'desconhecido',
      });
    }
  }
  return { accepted, rejected };
}
