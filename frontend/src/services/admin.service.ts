import { api } from './api';
import type { CreditTransaction } from './billing.service';

export interface AdminOverview {
  contas: {
    total: number;
    assinantes: number;
    pendentes: number;
    novos30Dias: number;
    conversaoPct: number;
  };
  porPlano: Array<{
    id: string;
    nome: string;
    assinantes: number;
    precoBrl: number;
  }>;
  receita: { mensalEstimadaBrl: number };
  creditos: {
    emCirculacao: number;
    gastosTotal: number;
    gastos30Dias: number;
    custoEstimado30DiasBrl: number;
  };
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  plan: string;
  credits: number;
  isAdmin: boolean;
  emailConfirmed: boolean;
  naFila: boolean;
  temAssinaturaStripe: boolean;
  createdAt: string;
  creditosGastos: number;
  ultimoUso: string | null;
}

export interface AdminUserDetail extends Omit<AdminUser, 'creditosGastos' | 'ultimoUso'> {
  stripeCustomerId: string | null;
  historico: CreditTransaction[];
}

export const adminService = {
  overview: () => api.get<AdminOverview>('/admin/overview').then((r) => r.data),
  users: (params: {
    busca?: string;
    plano?: string;
    page?: number;
    limit?: number;
  }) =>
    api
      .get<{ items: AdminUser[]; total: number; page: number }>('/admin/users', {
        params,
      })
      .then((r) => r.data),
  user: (id: string) =>
    api.get<AdminUserDetail>(`/admin/users/${id}`).then((r) => r.data),
  setPlan: (id: string, plano: string) =>
    api
      .patch<AdminUserDetail>(`/admin/users/${id}/plan`, { plano })
      .then((r) => r.data),
  adjustCredits: (id: string, amount: number, motivo: string) =>
    api
      .post<AdminUserDetail>(`/admin/users/${id}/credits`, { amount, motivo })
      .then((r) => r.data),
};
