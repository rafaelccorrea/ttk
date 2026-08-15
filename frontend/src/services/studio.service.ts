import { api } from './api';

export interface Script {
  id: string;
  type: 'live' | 'video';
  productName: string;
  productDescription: string | null;
  content: string;
  model: string | null;
  createdAt: string;
}

export interface PromptTemplate {
  id: string;
  title: string;
  mediaType: 'video' | 'image';
  durationSec: number | null;
  niches: string[];
  tags: string[];
  template: string;
  fields: string[];
}

export interface GenerateScriptInput {
  type: 'live' | 'video';
  productId?: string;
  /** Produto cadastrado pelo próprio vendedor (Campanhas). */
  userProductId?: string;
  productName?: string;
  productDescription?: string;
  tone?: string;
}

export const studioService = {
  async generate(input: GenerateScriptInput): Promise<Script> {
    const { data } = await api.post<Script>('/studio/scripts/generate', input);
    return data;
  },

  async listScripts(): Promise<Script[]> {
    const { data } = await api.get<Script[]>('/studio/scripts');
    return data;
  },

  async deleteScript(id: string): Promise<void> {
    await api.delete(`/studio/scripts/${id}`);
  },

  async listPrompts(filters?: {
    mediaType?: 'video' | 'image';
    search?: string;
  }): Promise<PromptTemplate[]> {
    const { data } = await api.get<PromptTemplate[]>('/studio/prompts', {
      params: filters,
    });
    return data;
  },
};
