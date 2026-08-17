import { api } from './api';

export interface CreditTransaction {
  id: string;
  amount: number;
  balanceAfter: number;
  kind: 'signup_bonus' | 'plan_grant' | 'purchase' | 'spend' | 'refund';
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
  prices: Record<string, ActionPrice>;
  /** recurso → liberado no plano atual (ex.: ai_videos, ingestion). */
  features?: Record<string, boolean>;
  /** recurso → plano mínimo. */
  featureMinPlan?: Record<string, string>;
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

export const billingService = {
  wallet: () => api.get<Wallet>('/billing/wallet').then((r) => r.data),
  plans: () => api.get<Plan[]>('/billing/plans').then((r) => r.data),
  packs: () => api.get<CreditPack[]>('/billing/packs').then((r) => r.data),
  purchasePack: (packId: string) =>
    api.post<Wallet>('/billing/packs/purchase', { packId }).then((r) => r.data),
  subscribe: (planId: string, cycle: BillingCycle = 'month') =>
    api.post<Wallet>('/billing/subscribe', { planId, cycle }).then((r) => r.data),
  // Stripe: cria a sessão e devolve a URL de pagamento.
  checkout: (item: { packId?: string; planId?: string; cycle?: BillingCycle }) =>
    api.post<{ url: string }>('/billing/checkout', item).then((r) => r.data),
  // Billing Portal do Stripe: cancelar, trocar cartão, baixar faturas.
  portal: () => api.post<{ url: string }>('/billing/portal').then((r) => r.data),
  confirmCheckout: (sessionId: string) =>
    api.post<Wallet>('/billing/checkout/confirm', { sessionId }).then((r) => r.data),
};
