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
  history: CreditTransaction[];
}

export interface Plan {
  id: string;
  name: string;
  priceBrl: number;
  monthlyCredits: number;
  highlight?: boolean;
  perks: string[];
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
  subscribe: (planId: string) =>
    api.post<Wallet>('/billing/subscribe', { planId }).then((r) => r.data),
};
