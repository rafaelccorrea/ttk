import { api, CREDITS_CHANGED_EVENT, TOKEN_STORAGE_KEY } from './api';

export interface CreditTransaction {
  id: string;
  amount: number;
  balanceAfter: number;
  kind:
    | 'signup_bonus'
    | 'sample_video'
    | 'plan_grant'
    | 'purchase'
    | 'spend'
    | 'refund'
    | 'referral_bonus'
    | 'referral_welcome';
  action?: string;
  reference?: string;
  description?: string;
  createdAt: string;
}

export interface ActionPrice {
  credits: number;
  label: string;
}

export interface Wallet {
  credits: number;
  plan: string;
  /**
   * Consumo do ciclo atual (desde o último crédito de plano / bônus de
   * cadastro): alimenta a barra e os avisos de 50/75/100% do cabeçalho.
   */
  consumo?: {
    concedidos: number;
    usados: number;
    restantes: number;
    percentual: number;
    desde: string | null;
  };
  /**
   * Conta interna: nada é debitado dela.
   *
   * Sem isto o cabeçalho mostraria um saldo parado para sempre — e um número
   * que nunca muda lê como bug, não como cortesia.
   */
  unlimited?: boolean;
  prices: Record<string, ActionPrice>;
  /** recurso → liberado no plano atual (ex.: ai_videos, ingestion). */
  features?: Record<string, boolean>;
  /** recurso → plano mínimo. */
  featureMinPlan?: Record<string, string>;
  /**
   * O vídeo com IA de cortesia — um por conta, para quem ainda não alcança o
   * Pro. Enquanto `available`, gerar um vídeo no preço de tabela não debita
   * nada; `credits` é o que deixa de ser cobrado, para a tela dizer o tamanho
   * do presente.
   */
  sampleVideo?: {
    available: boolean;
    credits: number;
  };
  /**
   * Conta gratuita em modo amostra (`docs/CONTA-FREE.md`).
   *
   * Existe porque a tela tinha duas respostas possíveis — "tem acesso" e "não
   * tem" — e agora existe uma terceira. Quem decide é `active`, e não
   * `plan === 'free'`: a regra de quem entra na amostra é do servidor, e as
   * duas pontas precisam ser a mesma regra.
   */
  freeSample?: {
    active: boolean;
    products: number;
    videos: number;
    refreshDays: number;
  };
  /**
   * A segunda carteira: tempo de copiloto ao vivo.
   *
   * Vem junto do saldo de créditos, mas separada dentro dele — as duas moedas
   * não se convertem uma na outra, e a interface não pode dar a entender que
   * convertem.
   */
  liveCopilot?: {
    /** Saldo em minutos. A venda é por hora; o consumo, por minuto. */
    minutes: number;
    trialMinutes: number;
    /** Esta conta ainda tem a cortesia de estreia por gastar? */
    trialAvailable: boolean;
    packs: Array<{ id: string; name: string; hours: number; priceBrl: number }>;
  };
  history: CreditTransaction[];
}

export type BillingCycle = 'month' | 'year';

export interface Plan {
  id: string;
  name: string;
  priceBrl: number;
  monthlyCredits: number;
  highlight?: boolean;
  perks: string[];
  /** Preço promocional em vigor: `listPriceBrl` é o de tabela, riscado. */
  offer?: { listPriceBrl: number; label: string };
  /** Cobrança anual: preço único no ano e a cota de créditos do período. */
  annual?: { priceBrl: number; credits: number };
}

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  priceBrl: number;
}

/** Painel do programa de indicação (`/indique`). */
export interface ReferralStats {
  /** Contas criadas pelo link. */
  indicados: number;
  /** Quantas dessas já assinaram — só elas pagam recompensa. */
  pagos: number;
  /** Créditos que as indicações já renderam, somados do extrato. */
  creditosGanhos: number;
  recompensa: { indicador: number; indicado: number };
}

/**
 * Uma carteira por navegação, não uma por componente.
 *
 * `wallet()` é chamada pelo layout, pelos três gates de rota, pelo `useSaldo`
 * de cada botão e por várias páginas — na pior tela eram quatro GETs
 * idênticos, dois deles segurando a renderização. Aqui a primeira chamada
 * vira a promessa compartilhada (quem chega enquanto ela voa recebe a mesma)
 * e o resultado vale por alguns segundos. Qualquer POST que gasta ou compra
 * crédito dispara `CREDITS_CHANGED_EVENT`, que zera o cache — o saldo do
 * cabeçalho continua atualizando na hora.
 */
const WALLET_TTL_MS = 15_000;
let walletCache: { token: string | null; value: Wallet; expiresAt: number } | null =
  null;
let walletEmVoo: { token: string | null; promise: Promise<Wallet> } | null = null;

export function invalidarWallet() {
  walletCache = null;
  walletEmVoo = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener(CREDITS_CHANGED_EVENT, invalidarWallet);
}

function walletCompartilhada(): Promise<Wallet> {
  // A chave é o token: trocar de conta na mesma aba não pode herdar saldo.
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (walletCache && walletCache.token === token && walletCache.expiresAt > Date.now()) {
    return Promise.resolve(walletCache.value);
  }
  if (walletEmVoo && walletEmVoo.token === token) return walletEmVoo.promise;
  const promise = api
    .get<Wallet>('/billing/wallet')
    .then((r) => {
      walletCache = { token, value: r.data, expiresAt: Date.now() + WALLET_TTL_MS };
      return r.data;
    })
    .finally(() => {
      if (walletEmVoo?.promise === promise) walletEmVoo = null;
    });
  walletEmVoo = { token, promise };
  return promise;
}

export const billingService = {
  wallet: walletCompartilhada,
  referrals: () =>
    api.get<ReferralStats>('/billing/referrals').then((r) => r.data),
  plans: () => api.get<Plan[]>('/billing/plans').then((r) => r.data),
  packs: () => api.get<CreditPack[]>('/billing/packs').then((r) => r.data),
  purchasePack: (packId: string) =>
    api.post<Wallet>('/billing/packs/purchase', { packId }).then((r) => r.data),
  subscribe: (planId: string, cycle: BillingCycle = 'month') =>
    api.post<Wallet>('/billing/subscribe', { planId, cycle }).then((r) => r.data),
  // Stripe: cria a sessão e devolve a URL de pagamento.
  checkout: (item: {
    packId?: string;
    /** Pacote de HORAS de live. Moeda separada — nunca vira crédito de IA. */
    livePackId?: string;
    planId?: string;
    cycle?: BillingCycle;
  }) =>
    api.post<{ url: string }>('/billing/checkout', item).then((r) => r.data),
  // Billing Portal do Stripe: cancelar, trocar cartão, baixar faturas.
  portal: () => api.post<{ url: string }>('/billing/portal').then((r) => r.data),
  confirmCheckout: (sessionId: string) =>
    api.post<Wallet>('/billing/checkout/confirm', { sessionId }).then((r) => r.data),
};
