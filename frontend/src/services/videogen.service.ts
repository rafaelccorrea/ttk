import { api } from './api';

export interface GeneratedMedia {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  aspectRatio: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';
  phase: 'image' | 'video';
  imageUrl: string | null;
  outputUrl: string | null;
  error: string | null;
  createdAt: string;
}

export const videogenService = {
  async generate(input: {
    kind: 'image' | 'video';
    prompt: string;
    aspectRatio?: string;
  }): Promise<GeneratedMedia> {
    const { data } = await api.post<GeneratedMedia>('/videogen', input);
    return data;
  },

  async list(): Promise<GeneratedMedia[]> {
    const { data } = await api.get<GeneratedMedia[]>('/videogen');
    return data;
  },

  async refresh(id: string): Promise<GeneratedMedia> {
    const { data } = await api.get<GeneratedMedia>(`/videogen/${id}`);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/videogen/${id}`);
  },
};
