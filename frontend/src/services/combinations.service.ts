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
};
