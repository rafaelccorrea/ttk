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
  /** 'seed' = curado à mão; 'auto' = destilado do que está vendendo agora. */
  source?: 'seed' | 'auto';
  updatedAt?: string;
}

export interface PromptsRefreshStatus {
  enabled: boolean;
  isRunning: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
}

export interface GenerateScriptInput {
  type: 'live' | 'video';
  productId?: string;
  /** Produto cadastrado pelo próprio vendedor (Campanhas). */
  userProductId?: string;
  productName?: string;
  productDescription?: string;
  /** Foto do produto já enviada — a IA olha para ela ao escrever as cenas. */
  productImageUrl?: string;
  tone?: string;
}

export const studioService = {
  async generate(input: GenerateScriptInput): Promise<Script> {
    const { data } = await api.post<Script>('/studio/scripts/generate', input);
    return data;
  },

  /** Sobe a foto do produto e devolve a URL para mandar junto do roteiro. */
  async uploadProductImage(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<{ url: string }>(
      '/studio/product-image',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data.url;
  },

  async listScripts(): Promise<Script[]> {
    const { data } = await api.get<Script[]>('/studio/scripts');
    return data;
  },

  async deleteScript(id: string): Promise<void> {
    await api.delete(`/studio/scripts/${id}`);
  },

  async promptsRefreshStatus(): Promise<PromptsRefreshStatus> {
    const { data } = await api.get<PromptsRefreshStatus>(
      '/studio/prompts/refresh/status',
    );
    return data;
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
