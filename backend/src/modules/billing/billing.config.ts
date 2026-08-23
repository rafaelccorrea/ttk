/**
 * Tabela de preços do PikPok — a regra de ouro: NUNCA vender crédito abaixo
 * do custo real da IA. Cada ação tem o custo estimado no PIOR caso (em BRL)
 * e o preço em créditos. O sanity-check no boot garante margem mínima.
 *
 * 1 crédito = R$ 0,10 de valor de face (base para precificar pacotes/planos).
 * Câmbio conservador usado nas estimativas: US$ 1 = R$ 6,00.
 */

import { isAdmin } from '../admin/admin.access';

export const CREDIT_VALUE_BRL = 0.1;

/** Margem mínima exigida sobre o custo real (40%). */
export const MIN_MARGIN = 1.4;

/**
 * Quanto custa, em BRL, UM crédito do PLANO da Higgsfield — a carteira que a
 * CLI gasta ao renderizar cena da Fábrica. Plano Ultra mensal: US$ 129 por
 * 3.000 créditos = US$ 0,043; no anual (US$ 99) cai para US$ 0,033. Fica o
 * mensal, que é o pior caso. `HIGGSFIELD_PLAN_CREDIT_USD` sobrescreve sem
 * deploy quando o plano mudar.
 */
export const HIGGSFIELD_PLAN_CREDIT_BRL =
  (Number(process.env.HIGGSFIELD_PLAN_CREDIT_USD) || 129 / 3000) * 6.0;

/**
 * Converte um custo real em BRL no preço em créditos, já com a margem mínima
 * e arredondado para cima em múltiplos de 5 — é o que a Fábrica usa para
 * precificar cada modelo de vídeo a partir do `custoPlano` dele, em vez de
 * cobrar 60 de qualquer cena. Arredondar para cima é o que mantém a regra de
 * ouro por construção: nenhum preço daqui fica abaixo de custo × margem.
 */
export function creditosPorCustoBrl(custoBrl: number): number {
  const minimo = (custoBrl * MIN_MARGIN) / CREDIT_VALUE_BRL;
  return Math.max(5, Math.ceil(minimo / 5) * 5);
}

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
  /*
   * Os tetos abaixo foram calculados no claude-opus-5 (US$ 5/25 por milhão) e
   * continuam aqui INTACTOS depois da migração para o gpt-5.4 (US$ 2,50/15),
   * que custa cerca de metade. Um teto folgado é seguro por construção: ele só
   * erra na direção de cobrar margem demais, e é o que `assertProfitability`
   * precisa. Baixá-los é decisão de preço — mexe na tabela de créditos e nos
   * planos via `worstCostPerCredit()` —, não consequência automática da troca
   * de fornecedor.
   */
  // gpt-5.4 (~3k in / 2k out): ~US$ 0,038 ≈ R$ 0,23. Teto mantido em R$ 0,39.
  script: { credits: 8, worstCaseCostBrl: 0.39, label: 'Roteiro com IA' },
  // gpt-5.4 (transcrição longa no prompt): ~US$ 0,07 ≈ R$ 0,42. Teto em R$ 0,72.
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
  /*
   * Soul + DoP: ~US$ 0,60 ≈ R$ 3,60. É o preço do driver de API (que só tem o
   * DoP) e o FALLBACK da Fábrica. Quando a cena roda pela CLI, com modelo
   * escolhível, o preço vem de `creditosDaCena` (modelos-de-video.ts): Kling
   * Turbo custa R$ 1,94 e Seedance 2.0 R$ 5,81 — 60 fixo era cobrar 3× numa e
   * ficar com 3% de margem na outra.
   */
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
   * em gpt-5.4-mini (barato, por fatia) e o reduce em gpt-5.4 (junta tudo num
   * único passo). O teto de R$ 1,00 foi calculado no par sonnet-5/opus-5 e
   * ficou folgado com os modelos atuais, que custam ~1/4 e ~1/2 daqueles; ver
   * a nota sobre tetos no topo de ACTION_PRICES.
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
 *   4 respostas × (2,8k de entrada em cache + ~60 de saída, gpt-5.4-mini)
 *     ≈ 4 × US$ 0,00059 ≈ US$ 0,0024 ≈ R$ 0,014
 *   reprocessamento em gpt-5.4 da faixa cinzenta (~10% das respostas,
 *     e é onde o custo de verdade mora)                        ≈ R$ 0,005
 *   total ≈ R$ 0,019 por minuto — menos da metade dos R$ 0,043 mantidos aqui.
 *
 * Os 2,8k em cache não são estimativa: são o `cached_tokens` MEDIDO contra a
 * API com uma base de 15 produtos e 12 FAQs (~1,9k tokens). A primeira chamada
 * volta com zero e da segunda em diante o prefixo inteiro vem cacheado, com a
 * latência caindo de ~1,6s para ~0,86s.
 *
 * A parcela da ESCRITA do cache (R$ 0,001/min na conta antiga) desapareceu: a
 * OpenAI não cobra para gravar prefixo. Em compensação a janela de cache é de
 * minutos e não de uma hora, então uma live com pausas longas relê o prefixo
 * frio mais vezes — e é justamente esse caso, que a medição acima NÃO cobre,
 * que mantém o teto em 0,043 em vez de acompanhar a queda. Folga aqui é o que
 * impede uma live atípica de virar prejuízo silencioso.
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
 * Cortesia de estreia: dez minutos de copiloto ao vivo, uma vez por conta —
 * e EXCLUSIVA da conta free (quem assina entra com as horas de adesão do
 * plano; a checagem vive em `grantLiveTrial`).
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
 * Add-ons de hora de live. Disponíveis a partir do Pro, junto com a feature
 * (a trava real é `assertFeature('live_copilot')` no checkout — plano mínimo
 * em `FEATURE_MIN_PLAN`).
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
  { id: 'live-1h', name: '1 hora de live', hours: 1, priceBrl: 9.9 },
  { id: 'live-5h', name: '5 horas de live', hours: 5, priceBrl: 39.9 },
  { id: 'live-15h', name: '15 horas de live', hours: 15, priceBrl: 99.9 },
  { id: 'live-40h', name: '40 horas de live', hours: 40, priceBrl: 219.9 },
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

/**
 * O piso da gravação que vira base de conhecimento de uma live.
 *
 * Não é limite técnico — o pipeline processa 40 segundos sem reclamar. É que o
 * resultado não presta: a base sai de produtos, preços e objeções ditos em voz
 * alta, e um recorte curto não tem nem catálogo nem repetição suficiente para o
 * copiloto responder qualquer coisa. O vendedor gastaria a transcrição para
 * receber uma base vazia e concluir que o produto não funciona.
 *
 * Dez minutos é o ponto a partir do qual uma live real já apresentou pelo menos
 * um produto por inteiro. Vale para a live; a transcrição avulsa do Estúdio
 * continua aceitando trechos curtos, que lá são o uso normal.
 */
export const LIVE_MIN_MINUTES = 10;

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
  /**
   * Teto de duração de UMA transmissão com o copiloto, em minutos.
   *
   * Não é cota mensal (isso é `monthlyLiveMinutes` + packs): é o freio de uma
   * live individual — protege o vendedor de esquecer o copiloto ligado e a
   * operação de uma run infinita. Ausente = usa o padrão do catálogo
   * (`DEFAULT_MAX_LIVE_DURATION_MINUTES`).
   */
  maxLiveDurationMinutes?: number;
  /**
   * Horas de live creditadas UMA VEZ, na primeira ativação do plano.
   *
   * É o "já começa com X horas" do catálogo: custo único de AQUISIÇÃO, não
   * cota recorrente — por isso não entra em `assertProfitability` (que compara
   * preço MENSAL com gasto MENSAL). O custo real de pior caso é conhecido e
   * aceito: 15h ≈ R$ 38,70 / 40h ≈ R$ 103,20 / 60h ≈ R$ 154,80, pago uma vez
   * por assinante e amortizado pela vida da assinatura. Upgrade concede só a
   * DIFERENÇA (ver `grantSignupLiveHours` no service) — nunca soma bônus.
   */
  signupLiveHours?: number;
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
 * Padrão do teto de duração de uma live para planos que não declaram o seu —
 * legados e desconhecidos caem aqui. 6h, o mesmo do Pro: um plano que saiu do
 * catálogo não deve ganhar de brinde um teto maior que o do catálogo atual.
 */
export const DEFAULT_MAX_LIVE_DURATION_MINUTES = 360;

/** Teto de duração de UMA transmissão para o plano, em minutos. */
export function planMaxLiveDurationMinutes(planId: string): number {
  const plan =
    PLANS.find((p) => p.id === planId) ??
    LEGACY_PLANS.find((p) => p.id === planId);
  return plan?.maxLiveDurationMinutes ?? DEFAULT_MAX_LIVE_DURATION_MINUTES;
}

/** Minutos do bônus de adesão do plano (zero para quem não declara). */
export function planSignupLiveMinutes(planId: string): number {
  const plan =
    PLANS.find((p) => p.id === planId) ??
    LEGACY_PLANS.find((p) => p.id === planId);
  return (plan?.signupLiveHours ?? 0) * 60;
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
 * Preço por crédito (o piso com a margem mínima é R$ 0,084). Nos planos com
 * horas de live inclusas, desconte antes o valor das horas ao preço avulso
 * (R$ 9,90/h) — é a conta que `billing.config.spec.ts` faz:
 *   Essencial       R$ 39,90 / 450 cr    = R$ 0,0887/cr → 1,48× o pior custo
 *   Essencial anual R$ 399,90 / 4.600 cr = R$ 0,0869/cr → 1,45× o pior custo
 *   Pro             (R$ 99,90 − 2h) / 1.000 cr  ≈ R$ 0,0801/cr
 *   Pro anual       (R$ 999,90 − 24h) / 10.400 cr ≈ R$ 0,0733/cr
 *   Business        (R$ 299,90 − 10h) / 2.800 cr ≈ R$ 0,0718/cr
 *   Business anual  (R$ 2.999,90 − 120h) / 28.800 cr ≈ R$ 0,0629/cr
 * O piso de verdade é o de `assertProfitability`, que soma as DUAS moedas
 * (créditos × pior custo + minutos × custo/minuto) × margem — todos os planos
 * acima passam. O desconto de volume (e o anual) sai da margem, nunca do
 * custo — é por isso que a cota acompanha o preço, e não o contrário.
 */
export const PLANS: Plan[] = [
  {
    id: 'essencial',
    name: 'Essencial',
    priceBrl: 39.9,
    monthlyCredits: 450,
    // "Já começa com 15 horas": o degrau de entrada entra transmitindo de
    // verdade, sem segunda compra no primeiro mês.
    signupLiveHours: 15,
    annual: { priceBrl: 399.9, credits: 4600 },
    perks: [
      '450 créditos/mês (ou 4.600 no plano anual)',
      'Descoberta completa: produtos, vídeos e criadores',
      'Roteiros e análises com Claude',
      'Transcrição de vídeos',
      'Imagens com IA',
      'Live Copilot no painel: já começa com 15 horas de live',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    /*
     * R$ 99,90 e não R$ 89,90 porque o plano passou a INCLUIR 2 horas de
     * copiloto ao vivo por mês — que avulsas custam R$ 9,90 cada. São +R$ 10
     * no preço por R$ 19,80 de valor entregue, e a margem segue acima do piso
     * (`assertProfitability` checa as DUAS moedas do plano no boot).
     */
    priceBrl: 99.9,
    monthlyCredits: 1000,
    /*
     * As 2 horas que fazem o Pro EXPERIMENTAR o copiloto de verdade, todo mês
     * — a cortesia de dez minutos continua existindo, mas é de estreia, uma
     * vez por conta. Quem OPERA com o copiloto (10h/mês + envio automático)
     * continua sendo o Business.
     */
    monthlyLiveMinutes: 120,
    // 6 horas por live: um turno inteiro de venda cabe; o que não cabe é o
    // esquecimento de madrugada. O Business, que opera de verdade, tem 24h.
    maxLiveDurationMinutes: 360,
    // 40 horas na adesão — quem assina o degrau do meio começa com um mês
    // inteiro de lives diárias no saldo.
    signupLiveHours: 40,
    highlight: true,
    annual: { priceBrl: 999.9, credits: 10400 },
    perks: [
      '1.000 créditos/mês (ou 10.400 no plano anual)',
      'Tudo do Essencial',
      'Vídeos com IA',
      'Multiplicador de conteúdo',
      /*
       * O gancho do funil, e é por isso que a redação é específica.
       *
       * O Pro ganha o copiloto no modo PAINEL — a resposta pronta na tela, para
       * copiar ou falar. O que ele não ganha é o envio automático, que fica no
       * Business por risco (ver FEATURE_MIN_PLAN.live_copilot). Dizer só "Live
       * Copilot" aqui prometeria o produto inteiro e transformaria o upgrade
       * numa reclamação; dizer o que ele é de fato faz as duas horas venderem
       * o degrau de cima em vez de substituí-lo.
       */
      'Live Copilot no painel: 2 horas por mês (24 horas no plano anual)',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    /*
     * R$ 299,90 e não R$ 269,90 porque as horas inclusas dobraram de 5 para
     * 10 por mês — que avulsas custam mais de R$ 79. São +R$ 30 no preço por
     * um múltiplo disso em valor entregue, e a margem segue acima do piso
     * (`assertProfitability` checa as DUAS moedas do plano no boot).
     */
    priceBrl: 299.9,
    monthlyCredits: 2800,
    /*
     * As 10 horas que fazem o Business valer o degrau.
     *
     * É a diferença de natureza entre os dois planos: o Pro EXPERIMENTA o
     * copiloto (2 horas por mês, no painel), o Business OPERA com ele: 10
     * horas por mês e o envio automático. Sem horas inclusas em volume, quem
     * assinasse o topo ainda teria que comprar add-on antes da primeira live —
     * e um plano que exige uma segunda compra para funcionar não é um plano,
     * é uma entrada.
     */
    monthlyLiveMinutes: 600,
    // 24 horas — o teto do próprio TikTok para uma transmissão contínua.
    maxLiveDurationMinutes: 1440,
    // 60 horas na adesão — o topo entra operando desde o primeiro dia.
    signupLiveHours: 60,
    /*
     * O anual do Business faltava, e a ausência era pior do que parece: é o
     * plano mais caro, e quem chega nele é exatamente quem estaria disposto a
     * pagar um ano adiantado. Oferecer desconto anual nos dois planos baratos e
     * não no caro inverte a lógica da escada — e some com a única compra do
     * catálogo que traz doze meses de caixa de uma vez.
     *
     * Mesma régua dos outros: ~dez mensalidades pelo ano (o desconto sai da
     * margem, não do custo), e o anual carrega também as 120 horas de live do
     * ano — `assertProfitability` soma as duas moedas na checagem. Mexer
     * nestes números sem refazer essa conta derruba o servidor no boot.
     */
    annual: { priceBrl: 2999.9, credits: 28800 },
    perks: [
      '2.800 créditos/mês (ou 28.800 no plano anual)',
      'Tudo do Pro',
      '10 horas de Live Copilot por mês (120 horas no plano anual)',
      'Envio automático: a IA responde no chat da live (exclusivo)',
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
 * Créditos de boas-vindas do cadastro — a cortesia da conta gratuita.
 *
 * Ficou em zero durante o paywall na entrada e voltou com o modo amostra: uma
 * conta que só olha não vira cliente. O vendedor precisa ver o roteiro sair, a
 * análise ficar pronta, a imagem aparecer — com o produto DELE. Vinte e cinco
 * créditos compram exatamente isso: três roteiros, ou uma análise mais um
 * roteiro, ou duas imagens. Dá para conhecer; não dá para operar.
 *
 * **Isto é dinheiro nosso saindo, e o número é o teto do prejuízo por conta.**
 * No pior caso (R$ 0,06 por crédito, ver `worstCostPerCredit`), 25 créditos
 * custam até R$ 1,50. É o preço de aquisição que estamos dispostos a pagar por
 * cadastro confirmado — e o que impede isso de virar torneira aberta é ser
 * concedido UMA VEZ POR CONTA (`ensureSignupBonus` grava a transação
 * `signup_bonus` e nunca repete) e não renovar no mês seguinte. Quem quiser
 * mais, assina.
 *
 * Subir este número sem olhar o custo por crédito é subir o custo de aquisição
 * de todo mundo que se cadastrar e nunca pagar, inclusive de quem se cadastrar
 * duas vezes.
 */
export const SIGNUP_BONUS_CREDITS = 25;

/**
 * Programa de indicação (`/indique`): a recompensa é em CRÉDITOS, não em
 * dinheiro.
 *
 * Crédito é o que a plataforma produz, então o prêmio custa o custo de uso —
 * não a margem inteira, como custaria uma comissão em reais. E ele volta para
 * dentro do produto: quem ganha precisa entrar para gastar.
 *
 * Os dois lados são pagos UMA vez, na primeira assinatura confirmada do
 * indicado — nunca no cadastro. Pagar no cadastro é pagar por e-mail
 * descartável; o pagamento é o único sinal que custa caro de falsificar.
 */
export const REFERRAL_REWARD = {
  /** Créditos para quem indicou. */
  indicador: 100,
  /** Créditos de boas-vindas para quem foi indicado, além do plano assinado. */
  indicado: 50,
} as const;


/**
 * Conta gratuita: o modo amostra (ver `docs/CONTA-FREE.md`).
 *
 * O paywall na entrada continua de pé — nada em `FEATURE_MIN_PLAN` foi
 * afrouxado. O que a conta `free` ganha é um conjunto FIXO de itens, servido
 * por uma API própria (`modules/free`), e é o "fixo" que faz o desenho
 * funcionar: a amostra é global e igual para todo mundo, então dar F5 não
 * revela item novo e criar uma segunda conta não revela absolutamente nada.
 * É por isso que este modo não precisa de defesa contra multi-conta — não há o
 * que ganhar burlando.
 *
 * Os números moram aqui, e não dentro do módulo `free`, porque são decisão de
 * negócio: quem for mexer no funil já está lendo este arquivo.
 */
export const FREE_SAMPLE = {
  /** Produtos na amostra. */
  products: 20,
  /** Vídeos na amostra. */
  videos: 10,
  /**
   * Criadores na amostra — a CAUDA do ranking, não o topo.
   *
   * Cinco perfis, e de propósito os menos relevantes: o valor da tela de
   * Criadores é descobrir QUEM está vendendo muito, e entregar os cinco
   * primeiros seria entregar exatamente isso. A cauda prova que a base existe,
   * mostra o formato da ficha e não substitui a lista paga.
   */
  creators: 5,
  /**
   * Validade do snapshot. É também a defasagem anunciada na tela: a amostra
   * não é o ranking de hoje, e isso é dito em vez de escondido.
   */
  refreshDays: 7,
  /**
   * Teto de itens da mesma categoria dentro da amostra.
   *
   * O topo puro do ranking devolve vinte itens do mesmo nicho, e aí a amostra
   * prova que a base é grande em um assunto só — o contrário do que ela
   * precisa provar.
   */
  maxPorCategoria: 2,
  /**
   * Quantas amostras distintas o rodízio consegue montar antes de repetir.
   *
   * A escolha lê um POOL desse tamanho (`products * poolFactor`) e recorta
   * dele uma fatia diferente a cada janela. Sem isso a rotação era
   * decorativa: a query sempre devolvia o topo do ranking, então a amostra da
   * semana seguinte era a mesma da anterior enquanto o ranking não mudasse —
   * e um ranking de 30 dias quase não muda em sete dias.
   *
   * Seis é o equilíbrio: um trimestre e meio sem repetir a mesma vitrine, e
   * ainda dentro dos itens bons o bastante para servirem de prova.
   */
  poolFactor: 6,
  /**
   * Instante em que a contagem de janelas começa: segunda-feira, 00:00 de
   * Brasília (o Brasil não tem mais horário de verão, então o -03:00 fixo vale
   * o ano inteiro).
   *
   * Antes o slot era alinhado à época Unix, que cai numa quinta — a amostra
   * trocava na madrugada de quinta, num horário que ninguém escolheu. Ancorar
   * aqui é o que faz a troca cair na segunda 00:00 para todo mundo, sem
   * depender de o agendador ter rodado.
   */
  rotationAnchorUtcMs: Date.UTC(2024, 0, 1, 3, 0, 0),
} as const;

/**
 * Hierarquia dos planos (maior = mais acesso). `free` não é um plano vendável:
 * é o estado "conta criada, ainda não pagou" — rank 0. Rank 0 deixou de
 * significar "nenhum recurso": com o modo amostra, as features cujo mínimo é
 * `free` abrem aqui (ver FEATURE_MIN_PLAN), limitadas pelo saldo de créditos.
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
  /*
   * Admin implica cortesia — nesta direção, e SÓ nesta. As listas continuam
   * separadas porque cortesia não pode dar poder (um e-mail em
   * COMP_ACCOUNT_EMAILS não vira admin), mas o contrário era uma pegadinha de
   * configuração: quem entrava em ADMIN_EMAILS e não em COMP_ACCOUNT_EMAILS
   * era o dono da casa travando em limite de crédito e de minuto de live no
   * meio de uma demonstração. Quem enxerga e altera a conta de todo mundo por
   * definição não paga para usar a própria plataforma.
   */
  if (isAdmin(email)) return true;
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
 * **A conta gratuita ganha as ferramentas de IA do Essencial, e não ganha o
 * dado.** A assimetria é o desenho inteiro, então vale explicar por quê:
 *
 * - As features de IA (`ai_*`, `studio_templates`, `uploads`) custam POR
 *   CHAMADA, e a chamada já é medida em crédito. Abrir a porta não abre a
 *   torneira: o teto é o saldo, e o saldo da conta gratuita é
 *   `SIGNUP_BONUS_CREDITS`, concedido uma vez e nunca renovado. Quem não paga
 *   consegue gerar um roteiro com o próprio produto — que é a única
 *   demonstração que converte — e para quando o saldo acaba.
 * - `discovery` custa POR CONSULTA ao fornecedor e é o produto em si: liberá-la
 *   não teria teto nenhum, e quem já viu o ranking inteiro não precisa assinar.
 *   Continua no piso pago. A conta gratuita vê a AMOSTRA (`modules/free`), que
 *   é fixa, congelada e não consulta fornecedor nenhum.
 *
 * Resumindo a régua: **o que é limitável por saldo abre no gratuito; o que é
 * ilimitável fica atrás do plano.**
 *
 * A diferença entre os planos pagos continua sendo de recurso, não só de cota.
 * Se o Pro fosse "o Essencial com mais créditos", os três degraus não teriam
 * sentido próprio: o que separa é o que cada um destrava — o Pro abre a
 * produção de vídeo (o item mais caro da tabela) e o Business abre a coleta.
 */
export const FEATURE_MIN_PLAN: Record<PlanFeature, string> = {
  /*
   * O dado de mercado. Único recurso do Essencial que NÃO desce para o
   * gratuito, porque é o único sem teto: cada consulta é dinheiro no
   * fornecedor e o valor está justamente em ver a lista inteira.
   */
  discovery: 'essencial',
  studio_templates: 'free',
  ai_scripts: 'free',
  ai_analyze: 'free',
  ai_transcribe: 'free',
  ai_images: 'free',
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
   * Então a trava mudou de lugar, não desapareceu: aqui o painel abre até
   * para a conta FREE — mas o free só tem os 10 minutos de cortesia (a
   * cortesia é EXCLUSIVA dele, ver `grantLiveTrial`): acabou, é 402 com o CTA
   * de assinar. Quem assina entra com as horas de adesão do degrau (15/40/60)
   * e não ganha cortesia. `trocarModo` (live-reply.service.ts) continua
   * exigindo Business para o `auto`.
   */
  live_copilot: 'free',
  // Campanhas é o construtor de anúncio em vídeo: persona + cenas animadas pelo
  // DoP. Acompanha `ai_videos` porque é o mesmo custo por trás.
  campaigns: 'pro',
  /*
   * Guardar arquivo do usuário no nosso bucket.
   *
   * Desce para o gratuito junto com as ferramentas de IA, e não por
   * generosidade: sem upload, a conta gratuita não consegue mandar a foto do
   * PRÓPRIO produto — e aí o roteiro que ela gera é sobre um produto
   * qualquer, que é exatamente a demonstração que não convence ninguém.
   *
   * O custo (storage + egress) é pequeno mas nunca zero, e aqui ele NÃO é
   * limitado por crédito — é a única exceção à régra "o que abre no gratuito é
   * limitável por saldo". Fica de olho: se virar problema, o teto natural é
   * quantidade de arquivos por conta, não plano.
   */
  uploads: 'free',
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
    const cycles: Array<[BillingCycle, string, number, number]> = [
      ['month', 'mensal', plan.priceBrl, plan.monthlyCredits],
      ...(plan.annual
        ? ([
            ['year', 'anual', plan.annual.priceBrl, plan.annual.credits],
          ] as Array<[BillingCycle, string, number, number]>)
        : []),
    ];
    for (const [cycleId, cycle, price, credits] of cycles) {
      if (credits === 0) continue;
      /*
       * As DUAS moedas entram na conta do plano.
       *
       * Enquanto nenhum plano incluía hora de live, olhar só os créditos dava o
       * número certo. No dia em que o Business passou a incluir 5 horas, esse
       * custo entrou no plano sem entrar em lugar nenhum da checagem — e o
       * servidor teria subido tranquilo anunciando uma margem que já não era
       * verdade. É exatamente o tipo de erosão silenciosa que esta função
       * existe para impedir, então ela precisa enxergar tudo que o plano promete.
       */
      const worstSpend =
        credits * perCredit +
        planLiveMinutes(plan, cycleId) * LIVE_COST_PER_MINUTE_BRL;
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
