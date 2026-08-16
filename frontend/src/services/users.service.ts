import { api } from './api';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  plan: string;
  createdAt: string;
  /** Só para a UI decidir se mostra a área administrativa — o backend é quem barra. */
  isAdmin?: boolean;
}

export const usersService = {
  async me(): Promise<UserProfile> {
    const { data } = await api.get<UserProfile>('/users/me');
    return data;
  },

  /** Sobe a foto de perfil e devolve o perfil ja atualizado. */
  async uploadAvatar(file: File): Promise<UserProfile> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<UserProfile>('/users/me/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  async updateProfile(displayName: string): Promise<UserProfile> {
    const { data } = await api.patch<UserProfile>('/users/me', {
      displayName,
    });
    return data;
  },
};
