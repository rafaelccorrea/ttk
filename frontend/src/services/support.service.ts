import { api } from './api';

export interface SupportMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  createdAt: string;
}

export const supportService = {
  async list(): Promise<SupportMessage[]> {
    const { data } = await api.get<SupportMessage[]>('/support/messages');
    return data;
  },
  /** Envia a mensagem; o backend devolve [mensagem do usuário, resposta automática]. */
  async send(text: string): Promise<SupportMessage[]> {
    const { data } = await api.post<SupportMessage[]>('/support/messages', { text });
    return data;
  },
};
