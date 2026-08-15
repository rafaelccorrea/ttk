import { api } from './api';

export interface AuthUserInfo {
  id: string;
  email: string;
  displayName?: string | null;
}

export interface RegisterResult {
  message: string;
  /** URL de preview do e-mail (apenas em dev, sem SMTP real). */
  previewUrl?: string;
  /** true durante o soft launch: o cadastro entrou na fila, sem e-mail ainda. */
  waitlisted?: boolean;
  /** Posição real na fila (contagem de cadastros, não número decorativo). */
  position?: number;
  /** Total de pessoas aguardando. */
  total?: number;
}

export const authService = {
  /** Config pública: hoje só diz se o cadastro está em lista de espera. */
  async config(): Promise<{ waitlist: boolean }> {
    const { data } = await api.get<{ waitlist: boolean }>('/auth/config');
    return data;
  },

  async register(email: string, password: string): Promise<RegisterResult> {
    const { data } = await api.post<RegisterResult>('/auth/register', {
      email,
      password,
    });
    return data;
  },

  async login(email: string, password: string) {
    const { data } = await api.post<{
      accessToken: string;
      user: AuthUserInfo;
    }>('/auth/login', { email, password });
    return data;
  },

  async confirm(token: string) {
    const { data } = await api.get<{
      message: string;
      accessToken: string;
      user: AuthUserInfo;
    }>('/auth/confirm', { params: { token } });
    return data;
  },

  async resend(email: string): Promise<RegisterResult> {
    const { data } = await api.post<RegisterResult>('/auth/resend', { email });
    return data;
  },

  /** Pede o link de redefinição. A resposta não revela se o e-mail existe. */
  async forgotPassword(email: string): Promise<RegisterResult> {
    const { data } = await api.post<RegisterResult>('/auth/forgot-password', {
      email,
    });
    return data;
  },

  async resetPassword(token: string, password: string) {
    const { data } = await api.post<{
      message: string;
      accessToken: string;
      user: AuthUserInfo;
    }>('/auth/reset-password', { token, password });
    return data;
  },
};
