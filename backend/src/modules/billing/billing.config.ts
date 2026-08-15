/**
 * Tabela de preços do PikPok — a regra de ouro: NUNCA vender crédito abaixo
 * do custo real da IA. Cada ação tem o custo estimado no PIOR caso (em BRL)
 * e o preço em créditos. O sanity-check no boot garante margem mínima.
 *
 * 1 crédito = R$ 0,10 de valor de face (base para precificar pacotes/planos).
 * Câmbio conservador usado nas estimativas: US$ 1 = R$ 6,00.
 */

export const CREDIT_VALUE_BRL = 0.1;

/** Margem mínima exigida sobre o custo real (40%). */
export const MIN_MARGIN = 1.4;

export type BillableAction =
  | 'script' // Roteiro com Claude (Estúdio)
  | 'analyze' // Análise de vídeo viral com Claude
  | 'transcribe' // Transcrição Whisper (até 25MB ≈ 20 min)
  | 'image' // Higgsfield Soul (texto → imagem)
  | 'video'; // Higgsfield Soul + DoP (texto → imagem → vídeo)

export interface ActionPrice {
  credits: number;
  /** Custo real estimado no pior caso, em BRL. */
  worstCaseCostBrl: number;
  label: string;
}

export const ACTION_PRICES: Record<BillableAction, ActionPrice> = {
  // Claude Opus (~3k in / 2k out): ~US$ 0,065 ≈ R$ 0,39
  script: { credits: 8, worstCaseCostBrl: 0.39, label: 'Roteiro com IA' },
  // Claude Opus (transcrição longa no prompt): ~US$ 0,12 ≈ R$ 0,72
  analyze: { credits: 12, worstCaseCostBrl: 0.72, label: 'Análise de vídeo viral' },
  // Whisper US$ 0,006/min × 20 min = US$ 0,12 ≈ R$ 0,72
  transcribe: { credits: 12, worstCaseCostBrl: 0.72, label: 'Transcrição de vídeo' },
  // Higgsfield Soul: ~US$ 0,10 ≈ R$ 0,60
  image: { credits: 12, worstCaseCostBrl: 0.6, label: 'Imagem com IA' },
  // Soul + DoP: ~US$ 0,60 ≈ R$ 3,60
  video: { credits: 60, worstCaseCostBrl: 3.6, label: 'Vídeo com IA' },
};

export interface Plan {
  id: string;
  name: string;
  priceBrl: number; // mensal
  monthlyCredits: number;
  highlight?: boolean;
  perks: string[];
}

/**
 * Planos: o preço do plano SEMPRE cobre o pior caso de gasto dos créditos
 * inclusos (créditos × pior custo/crédito da tabela) — checado no boot.
 * Pior custo/crédito da tabela ≈ R$ 0,06 (vídeo: 3,60/60).
 */
export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    priceBrl: 0,
    monthlyCredits: 0,
    perks: [
      '30 créditos de boas-vindas (uma vez)',
      'Descoberta completa (produtos, vídeos, criadores)',
      'Roteiros com gerador local ilimitados',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    priceBrl: 49.9,
    monthlyCredits: 500,
    perks: [
      '500 créditos/mês',
      'Roteiros e análises com Claude',
      'Transcrição Whisper',
      'Imagens com IA',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    priceBrl: 99.9,
    monthlyCredits: 1100,
    highlight: true,
    perks: [
      '1.100 créditos/mês',
      'Tudo do Starter',
      'Vídeos com IA (Higgsfield)',
      'Suporte prioritário',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    priceBrl: 199.9,
    monthlyCredits: 2300,
    perks: [
      '2.300 créditos/mês',
      'Tudo do Pro',
      'Multi-projetos',
      'Onboarding dedicado',
    ],
  },
];

/** Créditos de boas-vindas do cadastro (custo máximo p/ nós: 30 × R$0,06 = R$1,80/usuário). */
export const SIGNUP_BONUS_CREDITS = 30;

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  priceBrl: number;
}

/** Pacotes avulsos — sempre mais caros por crédito que os planos (incentiva assinar). */
export const CREDIT_PACKS: CreditPack[] = [
  { id: 'pack-100', name: '100 créditos', credits: 100, priceBrl: 14.9 },
  { id: 'pack-300', name: '300 créditos', credits: 300, priceBrl: 39.9 },
  { id: 'pack-1000', name: '1.000 créditos', credits: 1000, priceBrl: 119.9 },
];

/** Pior custo real por crédito entre todas as ações (BRL). */
export function worstCostPerCredit(): number {
  return Math.max(
    ...Object.values(ACTION_PRICES).map((a) => a.worstCaseCostBrl / a.credits),
  );
}

/**
 * Sanity-check executado no boot: se alguém editar a tabela e criar uma
 * combinação que dá prejuízo, o servidor se recusa a subir.
 */
export function assertProfitability(): string[] {
  const problems: string[] = [];
  const perCredit = worstCostPerCredit();

  for (const [action, p] of Object.entries(ACTION_PRICES)) {
    if (p.credits * CREDIT_VALUE_BRL < p.worstCaseCostBrl * MIN_MARGIN) {
      problems.push(
        `Ação "${action}": ${p.credits} créditos (R$ ${(p.credits * CREDIT_VALUE_BRL).toFixed(2)}) não cobre custo R$ ${p.worstCaseCostBrl.toFixed(2)} × margem ${MIN_MARGIN}`,
      );
    }
  }
  for (const plan of PLANS) {
    if (plan.monthlyCredits === 0) continue;
    const worstSpend = plan.monthlyCredits * perCredit;
    if (plan.priceBrl < worstSpend * MIN_MARGIN) {
      problems.push(
        `Plano "${plan.id}": R$ ${plan.priceBrl} não cobre pior gasto R$ ${worstSpend.toFixed(2)} × margem ${MIN_MARGIN}`,
      );
    }
  }
  for (const pack of CREDIT_PACKS) {
    const worstSpend = pack.credits * perCredit;
    if (pack.priceBrl < worstSpend * MIN_MARGIN) {
      problems.push(
        `Pacote "${pack.id}": R$ ${pack.priceBrl} não cobre pior gasto R$ ${worstSpend.toFixed(2)} × margem ${MIN_MARGIN}`,
      );
    }
  }
  return problems;
}
