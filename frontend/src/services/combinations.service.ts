import { api } from './api';

export type PlanFormat = '9:16' | '16:9' | '1:1';

export interface Combination {
  code: string;
  filename: string;
  hook: string;
  body: string;
  cta: string;
}

export interface CombinationPlan {
  id: string;
  sigla: string;
  format: PlanFormat;
  hooks: string[];
  bodies: string[];
  ctas: string[];
  createdAt: string;
}

export interface CombinationPlanSummary extends CombinationPlan {
  total: number;
}

export interface CombinationPlanDetail extends CombinationPlan {
  combinations: Combination[];
}

export interface CreatePlanInput {
  sigla: string;
  format: PlanFormat;
  hooks: string[];
  bodies: string[];
  ctas: string[];
  /** Clipes enviados, na MESMA ordem dos rótulos acima. */
  hookClipIds?: string[];
  bodyClipIds?: string[];
  ctaClipIds?: string[];
}

/** Onde o clipe entra na fórmula. */
export type ClipRole = 'hook' | 'body' | 'cta';

export interface CombinationClip {
  id: string;
  role: ClipRole;
  label: string;
  url: string;
  sizeBytes: number;
  createdAt: string;
}

export type CombinationVideoStatus =
  | 'pendente'
  | 'montando'
  | 'pronto'
  | 'falhou';

export interface CombinationVideo {
  id: string;
  planId: string;
  code: string;
  filename: string;
  url: string | null;
  status: CombinationVideoStatus;
  error: string | null;
  createdAt: string;
}

export const combinationsService = {
  async create(input: CreatePlanInput): Promise<CombinationPlanDetail> {
    const { data } = await api.post<CombinationPlanDetail>('/combinations', input);
    return data;
  },

  async list(): Promise<CombinationPlanSummary[]> {
    const { data } = await api.get<CombinationPlanSummary[]>('/combinations');
    return data;
  },

  async findOne(id: string): Promise<CombinationPlanDetail> {
    const { data } = await api.get<CombinationPlanDetail>(`/combinations/${id}`);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/combinations/${id}`);
  },

  // ----------------------------------------------------------- clipes

  async uploadClip(role: ClipRole, file: File): Promise<CombinationClip> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<CombinationClip>('/combinations/clips', form, {
      params: { role },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  async listClips(): Promise<CombinationClip[]> {
    const { data } = await api.get<CombinationClip[]>('/combinations/clips');
    return data;
  },

  async deleteClip(id: string): Promise<void> {
    await api.delete(`/combinations/clips/${id}`);
  },

  // ---------------------------------------------------------- montagem

  async render(planId: string): Promise<CombinationVideo[]> {
    const { data } = await api.post<CombinationVideo[]>(
      `/combinations/${planId}/render`,
    );
    return data;
  },

  async listVideos(planId: string): Promise<CombinationVideo[]> {
    const { data } = await api.get<CombinationVideo[]>(
      `/combinations/${planId}/videos`,
    );
    return data;
  },

  async gallery(): Promise<CombinationVideo[]> {
    const { data } = await api.get<CombinationVideo[]>('/combinations/gallery');
    return data;
  },
};
