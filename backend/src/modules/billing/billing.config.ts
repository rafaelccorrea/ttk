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

export type BillingCycle = 'month' | 'year';

/** Preço promocional: `priceBrl` é o que se cobra, `listPriceBrl` o riscado. */
export interface PlanOffer {
  listPriceBrl: number;
  label: string;
}

/**
 * Opção anual: cobrança única no ano, com o lote de créditos creditado de uma
 * vez (não é o mensal × 12 — é uma cota anual própria, precificada pelo custo).
 */
export interface PlanAnnual {
  priceBrl: number;
  credits: number;
}

export interface Plan {
  id: string;
  name: string;
  priceBrl: number; // mensal
  monthlyCredits: number;
  highlight?: boolean;
  perks: string[];
  offer?: PlanOffer;
  annual?: PlanAnnual;
}

/** Preço cobrado no ciclo escolhido. */
export function planPrice(plan: Plan, cycle: BillingCycle = 'month'): number {
  return cycle === 'year' ? (plan.annual?.priceBrl ?? 0) : plan.priceBrl;
}

/** Créditos liberados a cada cobrança do ciclo escolhido. */
export function planCredits(plan: Plan, cycle: BillingCycle = 'month'): number {
  return cycle === 'year' ? (plan.annual?.credits ?? 0) : plan.monthlyCredits;
}

/**
 * Planos: o preço do plano SEMPRE cobre o pior caso de gasto dos créditos
 * inclusos (créditos × pior custo/crédito da tabela) — checado no boot.
 * Pior custo/crédito da tabela ≈ R$ 0,06 (vídeo: 3,60/60), ou seja o piso
 * com a margem mínima é R$ 0,084 por crédito.
 *
 * Três degraus vendáveis, e nenhum gratuito: o dado de mercado que o PikPok
 * entrega é comprado de fornecedor pago (EchoTik), então conta grátis queima
 * custo por visitante. A prova de valor acontece ANTES do cadastro, na amostra
 * pública da landing.
 *
 * Os três existem para dar uma escolha do meio: com só dois, a decisão vira
 * "o barato ou o caro" e a maioria trava no barato. O Pro é a âncora — por isso
 * ele leva o `highlight` e o salto de recursos (vídeo com IA e multiplicador),
 * não só mais créditos.
 *
 * Preço por crédito (o piso com a margem mínima é R$ 0,084):
 *   Essencial       R$ 39,90 / 450 cr    = R$ 0,0887/cr → 1,48× o pior custo
 *   Essencial anual R$ 399,90 / 4.600 cr = R$ 0,0869/cr → 1,45× o pior custo
 *   Pro             R$ 89,90 / 1.000 cr  = R$ 0,0899/cr → 1,50× o pior custo
 *   Pro anual       R$ 899,90 / 10.400 cr= R$ 0,0865/cr → 1,44× o pior custo
 *   Business        R$ 249,90 / 2.800 cr = R$ 0,0892/cr → 1,49× o pior custo
 * O desconto de volume (e o anual) sai da margem, nunca do custo — é por isso
 * que a cota de créditos acompanha o preço, e não o contrário.
 */
export const PLANS: Plan[] = [
  {
    id: 'essencial',
    name: 'Essencial',
    priceBrl: 39.9,
    monthlyCredits: 450,
    annual: { priceBrl: 399.9, credits: 4600 },
    perks: [
      '450 créditos/mês (ou 4.600 no plano anual)',
      'Descoberta completa: produtos, vídeos e criadores',
      'Roteiros e análises com Claude',
      'Transcrição de vídeos',
      'Imagens com IA',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    priceBrl: 89.9,
    monthlyCredits: 1000,
    highlight: true,
    annual: { priceBrl: 899.9, credits: 10400 },
    perks: [
      '1.000 créditos/mês (ou 10.400 no plano anual)',
      'Tudo do Essencial',
      'Vídeos com IA',
      'Multiplicador de conteúdo',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    priceBrl: 249.9,
    monthlyCredits: 2800,
    perks: [
      '2.800 créditos/mês',
      'Tudo do Pro',
      'Coleta de dados automatizada',
      'Onboarding dedicado',
      'Suporte prioritário',
    ],
  },
];

/**
 * Planos que saíram do catálogo mas ainda têm assinantes ativos. Não aparecem
 * no /planos nem no checkout — existem só para a renovação mensal continuar
 * creditando quem assinou antes da mudança.
 */
export const LEGACY_PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceBrl: 49.9,
    monthlyCredits: 500,
    perks: ['500 créditos/mês', 'Plano descontinuado'],
  },
];

/** Busca um plano vendável ou legado — use em renovação, nunca em checkout. */
export function findPlan(id: string): Plan | undefined {
  return [...PLANS, ...LEGACY_PLANS].find((p) => p.id === id);
}

/**
 * Créditos de boas-vindas do cadastro. Zerado desde o paywall na entrada: quem
 * cria a conta ainda não pagou, e crédito de IA é dinheiro nosso saindo. Ficou
 * como constante (em vez de sumir) porque é a alavanca de uma campanha futura —
 * basta subir o número para religar o bônus, sem tocar em mais nada.
 */
export const SIGNUP_BONUS_CREDITS = 0;

/**
 * Hierarquia dos planos (maior = mais acesso). `free` não é um plano vendável:
 * é o estado "conta criada, pagamento pendente" — rank 0, nenhum recurso.
 * `starter` continua aqui como degrau legado: quem assinou antes mantém
 * exatamente o acesso que pagou.
 */
export const PLAN_RANK: Record<string, number> = {
  free: 0,
  // Starter empata com Essencial de propósito: é o legado equivalente (R$ 49,90
  // por 500 cr) e assinante pagante não pode perder o acesso que comprou.
  starter: 1,
  essencial: 1,
  pro: 2,
  business: 3,
};

/**
 * Contas de cortesia (`COMP_ACCOUNT_EMAILS=a@x.com,b@y.com`): sempre no plano
 * mais alto, sem passar pelo checkout. É como as contas da própria equipe
 * sobrevivem ao paywall — sem isso, no dia da virada nós mesmos perdemos o
 * acesso à plataforma, já que o time entra pelo mesmo login dos clientes.
 *
 * Vale só para o PLANO (acesso a recursos), nunca para créditos: quem está aqui
 * continua gastando crédito de IA normalmente, para que o custo do uso interno
 * apareça no relatório em vez de virar consumo invisível.
 */
export const COMP_ACCOUNT_PLAN = 'business';

export function compAccountEmails(): string[] {
  return (process.env.COMP_ACCOUNT_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isCompAccount(email: string | undefined | null): boolean {
  if (!email) return false;
  return compAccountEmails().includes(email.trim().toLowerCase());
}

export type PlanFeature =
  | 'discovery' // produtos, vídeos, criadores, tendências, favoritos
  | 'studio_templates' // roteiros com gerador local
  | 'ai_scripts' // roteiros com Claude
  | 'ai_analyze' // análise de vídeo viral (Claude)
  | 'ai_transcribe' // transcrição Whisper
  | 'ai_images' // imagens Higgsfield
  | 'ai_videos' // vídeos Higgsfield
  | 'multiplier' // multiplicador G×C×A
  | 'ingestion'; // coleta de dados (admin)

/**
 * Plano mínimo para cada recurso — a divisão oficial do produto.
 *
 * Nada começa no `free`: `discovery` é o dado que compramos do EchoTik (custo
 * por consulta) e as features de IA custam por chamada, então nenhuma delas
 * pode ficar aberta a quem não pagou.
 *
 * A diferença entre os planos pagos é de recurso, não só de cota. Se o Pro
 * fosse "o Essencial com mais créditos", os três degraus não teriam sentido
 * próprio: o que separa é o que cada um destrava — o Pro abre a produção de
 * vídeo (o item mais caro da tabela) e o Business abre a coleta.
 */
export const FEATURE_MIN_PLAN: Record<PlanFeature, string> = {
  discovery: 'essencial',
  studio_templates: 'essencial',
  ai_scripts: 'essencial',
  ai_analyze: 'essencial',
  ai_transcribe: 'essencial',
  ai_images: 'essencial',
  ai_videos: 'pro',
  multiplier: 'pro',
  ingestion: 'business',
};

/** Plano mínimo por ação cobrada (deriva de FEATURE_MIN_PLAN). */
export const ACTION_MIN_PLAN: Record<BillableAction, string> = {
  script: FEATURE_MIN_PLAN.ai_scripts,
  analyze: FEATURE_MIN_PLAN.ai_analyze,
  transcribe: FEATURE_MIN_PLAN.ai_transcribe,
  image: FEATURE_MIN_PLAN.ai_images,
  video: FEATURE_MIN_PLAN.ai_videos,
};

export function planAllows(userPlan: string, feature: PlanFeature): boolean {
  const need = PLAN_RANK[FEATURE_MIN_PLAN[feature]] ?? 0;
  return (PLAN_RANK[userPlan] ?? 0) >= need;
}

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
  for (const plan of [...PLANS, ...LEGACY_PLANS]) {
    // Cada ciclo é checado com a cota que ele libera: o anual não é o mensal
    // × 12, então precisa passar pelo mesmo teste com os próprios números.
    const cycles: Array<[string, number, number]> = [
      ['mensal', plan.priceBrl, plan.monthlyCredits],
      ...(plan.annual
        ? ([['anual', plan.annual.priceBrl, plan.annual.credits]] as Array<
            [string, number, number]
          >)
        : []),
    ];
    for (const [cycle, price, credits] of cycles) {
      if (credits === 0) continue;
      const worstSpend = credits * perCredit;
      if (price < worstSpend * MIN_MARGIN) {
        problems.push(
          `Plano "${plan.id}" (${cycle}): R$ ${price} não cobre pior gasto R$ ${worstSpend.toFixed(2)} × margem ${MIN_MARGIN}`,
        );
      }
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
