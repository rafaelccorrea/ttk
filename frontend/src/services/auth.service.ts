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

  async register(
    email: string,
    password: string,
    ref?: string,
  ): Promise<RegisterResult> {
    const { data } = await api.post<RegisterResult>('/auth/register', {
      email,
      password,
      // Só vai quando existe: mandar `ref: undefined` explícito não muda nada,
      // mas mandar string vazia quebraria a validação de UUID do backend.
      ...(ref ? { ref } : {}),
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

  /** Device flow: o que está sendo autorizado, para a pessoa conferir antes. */
  async deviceInfo(userCode: string): Promise<DeviceAuthorizationInfo> {
    const { data } = await api.get<DeviceAuthorizationInfo>(
      `/auth/device/${encodeURIComponent(userCode)}`,
    );
    return data;
  },

  async approveDevice(userCode: string) {
    const { data } = await api.post<{ status: string; deviceName?: string | null }>(
      '/auth/device/approve',
      { userCode },
    );
    return data;
  },

  async denyDevice(userCode: string) {
    const { data } = await api.post<{ status: string }>('/auth/device/deny', {
      userCode,
    });
    return data;
  },
};

export interface DeviceAuthorizationInfo {
  userCode: string;
  deviceName: string | null;
  status: 'pendente' | 'aprovado' | 'negado' | 'expirado';
  expiresAt: string;
}
