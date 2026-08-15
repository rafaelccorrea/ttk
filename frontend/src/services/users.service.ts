import { api } from './api';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  plan: string;
  createdAt: string;
}

export const usersService = {
  async me(): Promise<UserProfile> {
    const { data } = await api.get<UserProfile>('/users/me');
    return data;
  },

  async updateProfile(displayName: string): Promise<UserProfile> {
    const { data } = await api.patch<UserProfile>('/users/me', {
      displayName,
    });
    return data;
  },
};
