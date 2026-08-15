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
}

export const authService = {
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
};
