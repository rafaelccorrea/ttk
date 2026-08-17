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
  | 'transcribe' // Transcrição Whisper, por bloco de 10 min começado
  | 'image' // Higgsfield Soul (texto → imagem)
  | 'video' // Higgsfield Soul + DoP (texto → imagem → vídeo)
  | 'assembly' // Multiplicador: cada vídeo concatenado
  // O copiloto AO VIVO não entra aqui: ele gasta minutos de live, não crédito
  // de IA (ver "Horas de live — a segunda moeda", mais abaixo).
  | 'live_extract'; // Live Copilot: base de conhecimento de uma live gravada

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
  /*
   * Transcrição, por BLOCO de 10 minutos começado.
   *
   * Era um preço fixo calculado sobre "25MB ≈ 20 min" — e essa premissa é
   * falsa: o limite do upload é de tamanho, não de duração, e 25MB de áudio
   * comprimido a 64kbps são ~52 minutos. O Whisper cobra por minuto, então o
   * arquivo mais barato de enviar era justamente o mais caro de processar
   * (US$ 0,31 ≈ R$ 1,88 contra R$ 1,20 de face — prejuízo).
   *
   * Cobrando por bloco, o preço acompanha o custo em qualquer duração:
   * US$ 0,006/min × 10 min = US$ 0,06 ≈ R$ 0,36 por bloco.
   */
  transcribe: {
    credits: 6,
    worstCaseCostBrl: 0.36,
    label: 'Transcrição de vídeo (10 min)',
  },
  // Higgsfield Soul: ~US$ 0,10 ≈ R$ 0,60
  image: { credits: 12, worstCaseCostBrl: 0.6, label: 'Imagem com IA' },
  // Soul + DoP: ~US$ 0,60 ≈ R$ 3,60
  video: { credits: 60, worstCaseCostBrl: 3.6, label: 'Vídeo com IA' },
  /*
   * Montagem do Multiplicador, por vídeo gerado.
   *
   * Não tem IA no caminho, mas tem custo: alguns segundos de CPU para a
   * emenda, mais o MP4 guardado no S3 por tempo indeterminado. Uma matriz
   * cheia são 150 arquivos de dezenas de MB cada — deixar isso de graça é
   * pagar armazenamento por criativo que ninguém baixou.
   *
   * 1 crédito (R$ 0,10 de face) contra ~R$ 0,05 de CPU + storage no pior caso.
   * É barato de propósito: o valor do multiplicador está no volume, e um preço
   * que faça o vendedor pensar duas vezes antes de montar mata o produto.
   */
  assembly: { credits: 1, worstCaseCostBrl: 0.05, label: 'Vídeo montado' },
  /*
   * Extração da base de conhecimento de uma live gravada, cobrada uma vez por
   * live. O pipeline é map/reduce sobre ~40k tokens de transcrição: o map roda
   * em claude-sonnet-5 (barato, por fatia) e o reduce em claude-opus-5 (junta
   * tudo num único passo). Dá ~R$ 1,00 no pior caso.
   *
   * Os 17 créditos NÃO são arredondamento — 16 já passariam no teste de margem
   * da própria ação (1,60 >= 1,00 × 1,4 = 1,40), mas dariam R$ 0,0625 de custo
   * por crédito, acima do vídeo (3,60/60 = R$ 0,06), que hoje é o pior custo por
   * crédito da tabela. E `worstCostPerCredit()` alimenta a checagem dos PLANOS:
   * o piso subiria para R$ 0,0875/cr e derrubaria no boot o Essencial anual
   * (399,90/4.600 = R$ 0,0869) e o Pro anual (899,90/10.400 = R$ 0,0865).
   * Com 17 dá R$ 0,0588/cr, o pior custo continua sendo o do vídeo e nenhum
   * plano é afetado.
   */
  live_extract: {
    credits: 17,
    worstCaseCostBrl: 1.0,
    label: 'Base de conhecimento da live',
  },
};

/* ------------------------------------------------------------------ *
 *  Horas de live — a segunda moeda                                    *
 * ------------------------------------------------------------------ */

/**
 * O copiloto ao vivo NÃO gasta crédito de IA. Ele gasta minutos de live, que
 * são comprados à parte e vivem num saldo próprio.
 *
 * São duas moedas de propósito, e a razão é o que o cliente compra em cada
 * caso. Crédito é uma unidade de trabalho da plataforma: um roteiro, uma
 * imagem, uma transcrição — coisas discretas, que ele pede uma a uma e cujo
 * preço ele compara. Live não é discreta: ele liga o copiloto no começo da
 * transmissão e desliga no fim, e o que ele quer saber antes de começar é
 * "quantas horas eu ainda tenho", não "quantos créditos isso vai queimar por
 * minuto". Misturar as duas transforma toda live num cálculo mental e faz o
 * vendedor hesitar em deixar o copiloto ligado — que é exatamente o
 * comportamento que mata o produto.
 *
 * Na prática também protege o resto da plataforma: uma live longa não pode
 * consumir a cota que o vendedor reservou para produzir criativos no mês.
 */

/**
 * Custo real de um minuto de copiloto ao vivo, no pior caso, em BRL.
 *
 * Por minuto, com o teto de 4 respostas/min que o motor aplica:
 *   4 respostas × (1,5k de entrada em cache + 120 de saída, claude-haiku-4-5)
 *     ≈ 4 × US$ 0,00075 ≈ US$ 0,003 ≈ R$ 0,018
 *   reprocessamento em claude-opus-5 da faixa cinzenta (~10% das respostas,
 *     e é onde o custo de verdade mora)                        ≈ R$ 0,024
 *   fatia da escrita do cache da base (TTL de 1h)              ≈ R$ 0,001
 *   total ≈ R$ 0,043 por minuto, ou R$ 2,58 por hora cheia.
 */
export const LIVE_COST_PER_MINUTE_BRL = 0.043;

/**
 * Custo real de uma hora de transmissão, no pior caso (BRL).
 *
 * Número interno: entra no cinto de segurança das margens e em relatório nosso,
 * nunca numa resposta de API — é a nossa margem, não tem por que chegar ao
 * navegador do cliente. Arredondado em centavos porque 0,043 × 60 em ponto
 * flutuante devolve 2,5799999999999996, e esse lixo já vazaria a intenção.
 */
export function liveCostPerHourBrl(): number {
  return Math.round(LIVE_COST_PER_MINUTE_BRL * 60 * 100) / 100;
}

/**
 * Cortesia de estreia: dez minutos de copiloto ao vivo, uma vez por conta.
 *
 * Dez minutos é tempo de ver a coisa respondendo o próprio chat de verdade, que
 * é a única demonstração que convence, e é curto demais para substituir uma
 * live de trabalho. A concessão é por CONTA e não por base de conhecimento nem
 * por transmissão: em qualquer outro recorte, bastaria abrir uma base nova (ou
 * reconectar) a cada dez minutos para nunca pagar.
 *
 * Entra no mesmo saldo que as horas compradas, então o consumo não precisa
 * saber se está gastando cortesia ou hora paga — some sozinha quando acaba.
 */
export const LIVE_TRIAL_MINUTES = 10;

export interface LiveHourPack {
  id: string;
  name: string;
  hours: number;
  priceBrl: number;
}

/**
 * Add-ons de hora de live. Exclusivos do Business, como a própria feature.
 *
 * O preço por hora cai com o volume, e a margem é bem maior que a dos pacotes
 * de crédito — não por ganância, mas porque o custo de IA é só uma parte do que
 * uma hora de copiloto consome: é uma hora em que a nossa infraestrutura está
 * conectada ao chat de alguém, respondendo em nome dele, com o suporte que isso
 * implica quando algo dá errado ao vivo.
 */
export const LIVE_HOUR_PACKS: LiveHourPack[] = [
  /*
   * A hora avulsa é a mais CARA por hora, e tem de ser.
   *
   * Ela existe para um momento específico: o saldo acabou com a live no ar, e o
   * vendedor precisa de mais uma hora agora — não de um pacote de quarenta. Sem
   * ela, a única saída no meio da transmissão é comprar R$ 49,90 de uma vez, e
   * quem não quer gastar isso simplesmente desliga o copiloto no meio da venda.
   *
   * O preço acima do pacote de 5h é o que mantém a escada de pé: se a avulsa
   * saísse a R$ 9,00, cinco delas custariam menos que o pacote de 5h e o
   * desconto de volume viraria pegadinha ao contrário. `assertProfitability` e o
   * teste da escada derrubam qualquer valor que inverta isso.
   */
  { id: 'live-1h', name: '1 hora de live', hours: 1, priceBrl: 11.9 },
  { id: 'live-5h', name: '5 horas de live', hours: 5, priceBrl: 49.9 },
  { id: 'live-15h', name: '15 horas de live', hours: 15, priceBrl: 129.9 },
  { id: 'live-40h', name: '40 horas de live', hours: 40, priceBrl: 299.9 },
];

export function findLiveHourPack(id: string): LiveHourPack | undefined {
  return LIVE_HOUR_PACKS.find((p) => p.id === id);
}

/** Minutos entregues por um pacote. */
export function livePackMinutes(pack: LiveHourPack): number {
  return pack.hours * 60;
}

/** Tamanho do bloco de transcrição, em minutos (ver `ACTION_PRICES.transcribe`). */
export const TRANSCRIBE_BLOCK_MINUTES = 10;

/**
 * Teto de duração aceito numa transcrição.
 *
 * O teto era de 120 minutos porque um arquivo longo virava uma única chamada de
 * vários minutos segurando um worker. O pipeline do Live Copilot desmontou esse
 * argumento: a live é fatiada e transcrita em background, então a duração deixou
 * de prender qualquer requisição — e uma live de TikTok passa fácil das 2 horas.
 *
 * O teto continua existindo, agora só como limite de sanidade do pior caso: um
 * arquivo absurdo é erro de upload, não uso legítimo.
 */
export const TRANSCRIBE_MAX_MINUTES = 300;

/** Blocos cobrados para uma duração em segundos (sempre ≥ 1). */
export function transcribeBlocks(durationSeconds: number): number {
  const minutos = durationSeconds / 60;
  return Math.max(Math.ceil(minutos / TRANSCRIBE_BLOCK_MINUTES), 1);
}

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
  /**
   * Minutos de Live Copilot inclusos por mês. Ausente = nenhum.
   *
   * Separado de `monthlyCredits` porque são moedas que não se convertem: hora
   * de live não vira crédito de IA nem o contrário. Ver `planLiveMinutes`.
   */
  monthlyLiveMinutes?: number;
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
 * Minutos de live que o plano entrega a cada cobrança.
 *
 * Moeda separada da de créditos, então grandeza separada aqui — somar as duas
 * num número só é justamente o erro que a arquitetura de duas carteiras existe
 * para evitar.
 *
 * No anual entrega o ANO inteiro de uma vez (12 × o mensal), igual aos
 * créditos. Minuto de live não expira, então adiantar não cria pressão de uso;
 * e entregar mês a mês exigiria um cron de renovação que hoje não existe — o
 * que na prática significaria um assinante anual sem hora nenhuma depois do
 * primeiro mês.
 */
export function planLiveMinutes(
  plan: Plan,
  cycle: BillingCycle = 'month',
): number {
  const porMes = plan.monthlyLiveMinutes ?? 0;
  return cycle === 'year' ? porMes * 12 : porMes;
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
 *   Business anual  R$ 2.499,90 / 28.800 cr = R$ 0,0868/cr → 1,45× o pior custo
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
    /*
     * O anual do Business faltava, e a ausência era pior do que parece: é o
     * plano mais caro, e quem chega nele é exatamente quem estaria disposto a
     * pagar um ano adiantado. Oferecer desconto anual nos dois planos baratos e
     * não no caro inverte a lógica da escada — e some com a única compra do
     * catálogo que traz doze meses de caixa de uma vez.
     *
     * Mesma régua dos outros: dez mensalidades pelo ano, e a cota anual em
     * ~0,86 da mensal × 12 (o desconto sai da margem, não do custo). Dá R$
     * 0,0868 por crédito — acima do piso de R$ 0,084 e alinhado ao Pro anual
     * (R$ 0,0865). Mexer nestes números sem refazer essa conta derruba o
     * servidor no boot, em `assertProfitability`.
     */
    annual: { priceBrl: 2499.9, credits: 28800 },
    perks: [
      '2.800 créditos/mês (ou 28.800 no plano anual)',
      'Tudo do Pro',
      'Live Copilot: a IA responde o chat durante a sua live (exclusivo)',
      `${LIVE_TRIAL_MINUTES} minutos de copiloto ao vivo para testar`,
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
 * Vale para o PLANO e, desde a fase 3, também para o SALDO: a conta da equipe
 * não gasta crédito nem minuto de live.
 *
 * A regra anterior era o contrário — "continua gastando normalmente, para que o
 * custo do uso interno apareça no relatório". O raciocínio estava certo e a
 * conclusão, errada: o custo do uso interno aparece em `ai_cost_events`, que
 * grava os tokens REAIS de cada chamada e é a fonte do relatório de margem. O
 * saldo de créditos nunca foi essa fonte — ele é preço de venda, não custo. Ou
 * seja: cobrar da própria equipe não media nada e ainda produzia o pior
 * resultado possível, que é a conta de quem opera o produto travar no meio de
 * uma demonstração por falta de saldo.
 *
 * O gasto continua no extrato, com valor zero e etiqueta de uso interno: o
 * histórico segue contando o que foi feito, sem mexer no saldo.
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

/**
 * Checkout de mentira, que credita sem cobrar. Existe para o desenvolvimento
 * não depender do gateway.
 *
 * A checagem do NODE_ENV é o cinto de segurança: `ALLOW_DEV_CHECKOUT=true` é
 * uma linha de `.env` que se copia sem querer para o servidor de produção, e lá
 * ela seria uma torneira aberta de créditos — qualquer usuário assinando o
 * plano Business de graça pelo endpoint. Em produção nem a variável liga.
 */
export function devCheckoutEnabled(): boolean {
  return (
    process.env.ALLOW_DEV_CHECKOUT === 'true' &&
    process.env.NODE_ENV !== 'production'
  );
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
  | 'live_copilot' // base de conhecimento a partir de live gravada
  | 'campaigns' // campanhas com personas e cenas em vídeo
  | 'uploads' // guardar arquivo nosso no bucket (foto de produto, avatar)
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
  /*
   * O Live Copilot abre no PRO — mas só o modo painel.
   *
   * A trava anterior era o Business inteiro, por RISCO e não por preço: o modo
   * automático é o único lugar do produto em que escrevemos dentro da
   * plataforma do vendedor, em nome dele, contra os Termos do TikTok. Quem leva
   * o ban é ele, e isso pede o degrau que vem com suporte de gente.
   *
   * Esse argumento vale para o ENVIO, não para a leitura. O modo painel entrega
   * o valor central — a resposta certa, na hora certa, com o preço certo — sem
   * tocar no chat e sem risco nenhum de ToS. Prender o painel junto do envio era
   * cobrar o degrau mais caro pela metade que não tem risco.
   *
   * Então a trava mudou de lugar, não desapareceu: aqui abre o painel para o
   * Pro, e `trocarModo` (live-reply.service.ts) exige Business para o `auto`.
   * Os dez minutos de cortesia passam a ser a PROVA do Pro — ele conhece o
   * produto respondendo pelo painel e sobe para o Business quando quiser que o
   * copiloto escreva sozinho. Um recurso que ninguém experimenta não vende o
   * degrau de cima.
   */
  live_copilot: 'pro',
  // Campanhas é o construtor de anúncio em vídeo: persona + cenas animadas pelo
  // DoP. Acompanha `ai_videos` porque é o mesmo custo por trás.
  campaigns: 'pro',
  /*
   * Guardar arquivo do usuário no nosso bucket.
   *
   * Não passa por IA, mas é dinheiro saindo (storage + egress) e ficava aberto
   * a conta `free` — ou seja, a quem ainda não pagou. É o piso pago porque o
   * custo é pequeno, mas nunca zero.
   */
  uploads: 'essencial',
  ingestion: 'business',
};

/** Plano mínimo por ação cobrada (deriva de FEATURE_MIN_PLAN). */
export const ACTION_MIN_PLAN: Record<BillableAction, string> = {
  script: FEATURE_MIN_PLAN.ai_scripts,
  analyze: FEATURE_MIN_PLAN.ai_analyze,
  transcribe: FEATURE_MIN_PLAN.ai_transcribe,
  image: FEATURE_MIN_PLAN.ai_images,
  video: FEATURE_MIN_PLAN.ai_videos,
  assembly: FEATURE_MIN_PLAN.multiplier,
  live_extract: FEATURE_MIN_PLAN.live_copilot,
};

export function planAllows(userPlan: string, feature: PlanFeature): boolean {
  const need = PLAN_RANK[FEATURE_MIN_PLAN[feature]] ?? 0;
  return (PLAN_RANK[userPlan] ?? 0) >= need;
}

/**
 * Recursos que já existem no código mas ainda NÃO foram lançados.
 *
 * O Live Copilot é entregue por fases: a base de conhecimento (fase 0) já roda
 * em produção, o copiloto ao vivo ainda não. Sem esta trava, o degrau Business
 * passaria a exibir um "Copiloto de Live" que só faz metade do que o nome
 * promete — e um recurso pela metade num plano de R$ 249,90 não é preview, é
 * promessa quebrada.
 *
 * A trava é de LANÇAMENTO, não de plano: as duas checagens são independentes
 * porque respondem perguntas diferentes ("esta conta pagou por isso?" e "isto
 * já está pronto para alguém depender?"), e confundir as duas é como recursos
 * incompletos vazam para produção.
 */
export const FEATURES_NAO_LANCADAS: PlanFeature[] = ['live_copilot'];

/**
 * Já pode aparecer para cliente?
 *
 * `LAUNCH_LIVE_COPILOT=true` destrava quando as fases fecharem — uma variável
 * de ambiente, e não um deploy de código, para que o lançamento seja uma
 * decisão de negócio tomada na hora que se quiser, sem esperar build.
 *
 * As contas de cortesia (a equipe) atravessam a trava mesmo desligada: é o que
 * permite testar o recurso em produção, com dado real, antes de abrir para
 * quem paga. Ver `isCompAccount`.
 */
export function featureLancada(feature: PlanFeature): boolean {
  if (!FEATURES_NAO_LANCADAS.includes(feature)) return true;
  if (feature === 'live_copilot') {
    return process.env.LAUNCH_LIVE_COPILOT === 'true';
  }
  return false;
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
  /*
   * Os add-ons de hora passam pelo mesmo cinto de segurança, com a moeda deles.
   * Não há `perCredit` aqui: a hora de live não é conversível em crédito de IA,
   * e o custo dela é o do motor de resposta, medido por minuto.
   */
  for (const pack of LIVE_HOUR_PACKS) {
    const worstSpend = livePackMinutes(pack) * LIVE_COST_PER_MINUTE_BRL;
    if (pack.priceBrl < worstSpend * MIN_MARGIN) {
      problems.push(
        `Pacote de live "${pack.id}": R$ ${pack.priceBrl} não cobre pior gasto R$ ${worstSpend.toFixed(2)} × margem ${MIN_MARGIN}`,
      );
    }
  }
  return problems;
}
