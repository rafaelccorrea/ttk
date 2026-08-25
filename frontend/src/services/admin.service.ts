import { api } from './api';
import type { CreditTransaction } from './billing.service';

export interface AdminOverview {
  contas: {
    total: number;
    /** Assinaturas vivas no Stripe — dinheiro entrando de fato. */
    pagantes: number;
    /** Contas da equipe (COMP_ACCOUNT_EMAILS): fora da conversão. */
    cortesia: number;
    /** Plano liberado no banco — inclui cortesia e liberações do suporte. */
    comPlanoLiberado: number;
    pendentes: number;
    novos30Dias: number;
    novos7Dias: number;
    /** Abriram o app (API autenticada) nos últimos 7 / 30 dias. */
    ativos7Dias: number;
    ativos30Dias: number;
    /** Cadastro por e-mail que nunca confirmou (e sem Google). */
    naoConfirmaram: number;
    /** Mais de 7 dias de casa e nenhum crédito gasto. */
    semUso: number;
    /** Contas com Google vinculado (login social). */
    viaGoogle: number;
    conversaoPct: number;
  };
  /** Últimos 14 dias, do mais antigo ao de hoje. */
  cadastrosPorDia: Array<{ dia: string; total: number }>;
  porPlano: Array<{
    id: string;
    nome: string;
    assinantes: number;
    precoBrl: number;
  }>;
  receita: {
    totalBrl: number;
    ultimos30DiasBrl: number;
    cobrancas: number;
    fonte: 'stripe' | 'indisponivel';
  };
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
  /** Conta com Google vinculado (cadastro ou vínculo pelo login social). */
  viaGoogle: boolean;
  naFila: boolean;
  temAssinaturaStripe: boolean;
  cortesia: boolean;
  createdAt: string;
  emailConfirmedAt: string | null;
  /** Última vez que bateu na API autenticada (folga de 5 min). */
  lastSeenAt: string | null;
  creditosGastos: number;
  /** Último lançamento de consumo no extrato. */
  ultimoUso: string | null;
  liveMinutes: number;
  uso: {
    produtos: number;
    campanhas: number;
    videosGerados: number;
    lives: number;
  };
}

export type AdminSituacao =
  | 'confirmado'
  | 'nao_confirmado'
  | 'google'
  | 'stripe'
  | 'fila'
  | 'ativos_7d'
  | 'inativos_30d'
  | 'nunca_usou';

export type AdminOrdenar = 'cadastro' | 'ultimo_acesso' | 'gastos' | 'creditos' | 'email';

export interface AdminUsersParams {
  busca?: string;
  plano?: string;
  situacao?: AdminSituacao;
  cadastroDias?: number;
  ordenar?: AdminOrdenar;
  direcao?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface LiveMinuteTransaction {
  id: string;
  minutes: number;
  kind: string;
  description: string | null;
  createdAt: string;
}

export interface AdminUserDetail {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  plan: string;
  credits: number;
  liveMinutes: number;
  isAdmin: boolean;
  cortesia: boolean;
  emailConfirmed: boolean;
  viaGoogle: boolean;
  naFila: boolean;
  stripeCustomerId: string | null;
  createdAt: string;
  linhaDoTempo: {
    cadastro: string;
    emailConfirmado: string | null;
    entrouNaFila: string | null;
    liberadoDaFila: string | null;
    cortesiaDeLive: string | null;
    ultimoAcesso: string | null;
    ultimaAlteracao: string;
  };
  indicacao: {
    indicadoPor: string | null;
    recompensaPagaEm: string | null;
    indicados: number;
    indicadosQuePagaram: number;
  };
  atividade: {
    produtos: number;
    personas: number;
    roteiros: number;
    multiplicador: number;
    campanhas: { total: number; porStatus: Record<string, number> };
    videosGerados: { total: number; prontos: number; falhos: number; ultimo: string | null };
    lives: { total: number; minutosUsados: number; ultima: string | null };
    creditosGastos: number;
  };
  /** Custo real na IA (telemetria) contra o que pagou em crédito. */
  custoIa: {
    totalBrl: number;
    ultimos30DiasBrl: number;
    eventos: number;
    receitaEmCreditosBrl: number;
  };
  historico: CreditTransaction[];
  historicoMinutos: LiveMinuteTransaction[];
}

export interface SupportConversation {
  userId: string;
  email: string | null;
  displayName: string | null;
  plan: string | null;
  ultimaMensagem: string;
  ultimaEm: string;
  naoLidas: number;
  total: number;
}

export interface SupportChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  createdAt: string;
}

export interface SupportConversationDetail {
  user: { id: string; email: string; displayName: string | null; plan: string };
  mensagens: SupportChatMessage[];
}

export const adminService = {
  /** Chat de suporte — só admins enxergam e respondem. */
  supportConversas: () =>
    api.get<SupportConversation[]>('/admin/support/conversas').then((r) => r.data),
  supportNaoLidas: () =>
    api.get<{ total: number }>('/admin/support/nao-lidas').then((r) => r.data.total),
  supportConversa: (userId: string) =>
    api
      .get<SupportConversationDetail>(`/admin/support/conversas/${userId}`)
      .then((r) => r.data),
  supportResponder: (userId: string, text: string) =>
    api
      .post<SupportChatMessage>(`/admin/support/conversas/${userId}/mensagens`, { text })
      .then((r) => r.data),
  overview: () => api.get<AdminOverview>('/admin/overview').then((r) => r.data),
  users: (params: AdminUsersParams) =>
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
  adjustCredits: (id: string, amount: number, motivo: string, notificar = false) =>
    api
      .post<AdminUserDetail>(`/admin/users/${id}/credits`, { amount, motivo, notificar })
      .then((r) => r.data),
  /** E-mail avisando de créditos já concedidos — não mexe no saldo. */
  notificarCredito: (id: string, amount: number, mensagem?: string) =>
    api
      .post<{ enviado: boolean; para: string }>(`/admin/users/${id}/aviso-credito`, {
        amount,
        mensagem: mensagem || undefined,
      })
      .then((r) => r.data),
};

/* ------------------------------------------------------------------ */
/* Auditoria                                                            */
/* ------------------------------------------------------------------ */

export interface AuditLog {
  id: string;
  userId: string | null;
  userEmail: string | null;
  categoria: string;
  acao: string;
  metodo: string;
  rota: string;
  alvoId: string | null;
  statusCode: number;
  resultado: 'ok' | 'erro';
  erro: string | null;
  detalhe: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  duracaoMs: number;
  admin: boolean;
  createdAt: string;
}

export interface AuditParams {
  busca?: string;
  userId?: string;
  categoria?: string;
  acao?: string;
  resultado?: 'ok' | 'erro';
  /** 'true' = só equipe, 'false' = só clientes. */
  admin?: 'true' | 'false';
  desde?: string;
  ate?: string;
  page?: number;
  limit?: number;
}

export interface AuditOpcao {
  categoria: string;
  acao: string;
  total: number;
}

export interface AuditResumo {
  dias: number;
  porDia: Array<{ dia: string; total: number; erros: number }>;
  porCategoria: Array<{ categoria: string; total: number }>;
  usuariosAtivos: number;
}

export const auditService = {
  listar: (params: AuditParams) =>
    api
      .get<{ items: AuditLog[]; total: number; page: number; limit: number }>('/admin/audit', {
        params,
      })
      .then((r) => r.data),
  opcoes: () => api.get<AuditOpcao[]>('/admin/audit/opcoes').then((r) => r.data),
  resumo: (dias = 7) =>
    api.get<AuditResumo>('/admin/audit/resumo', { params: { dias } }).then((r) => r.data),
};
