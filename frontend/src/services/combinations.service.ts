import { api } from './api';

export type PlanFormat = '9:16' | '16:9' | '1:1';

/**
 * Quanto este vídeo repete os que vêm antes dele na ordem de postagem.
 *
 * `original` — nenhum vídeo anterior usou este gancho.
 * `parecido` — o gancho já apareceu, mas o corpo é novo.
 * `muito-parecido` — gancho e corpo já apareceram; só o CTA muda.
 */
export type CombinationOriginality = 'original' | 'parecido' | 'muito-parecido';

export const ORIGINALITY_LABEL: Record<CombinationOriginality, string> = {
  original: 'Original',
  parecido: 'Repete um pouco',
  'muito-parecido': 'Bem parecido',
};

export const ORIGINALITY_HINT: Record<CombinationOriginality, string> = {
  original: 'Gancho inédito — poste estes primeiro.',
  parecido: 'O gancho já foi ao ar; o corpo é novo. Deixe para o meio da fila.',
  'muito-parecido':
    'Gancho e corpo já foram ao ar; só o CTA muda. Deixe por último.',
};

export interface Combination {
  code: string;
  filename: string;
  hook: string;
  body: string;
  cta: string;
  originality: CombinationOriginality;
  /** Posição na ordem recomendada de postagem, começando em 1. */
  postOrder: number;
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
  /** Zero nas montagens anteriores à etiqueta — a tela não mostra ordem. */
  postOrder: number;
  originality: CombinationOriginality;
  createdAt: string;
}

/**
 * Um produto na galeria, com os vídeos que ele já rendeu.
 *
 * Os vídeos vêm na ordem de postagem (`postOrder`), não na de criação — é a
 * ordem em que vale a pena publicar.
 */
export interface GaleriaGrupo {
  planId: string;
  sigla: string;
  format: PlanFormat | null;
  /** `false` quando o plano foi apagado mas os vídeos continuam guardados. */
  planoExiste: boolean;
  atualizadoEm: string;
  videos: CombinationVideo[];
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

  /** Galeria agrupada por produto, do produto mais recente para o mais antigo. */
  async gallery(): Promise<GaleriaGrupo[]> {
    const { data } = await api.get<GaleriaGrupo[]>('/combinations/gallery');
    return data;
  },

  /** Descarta um vídeo montado — o arquivo sai do bucket junto. */
  async deleteVideo(id: string): Promise<void> {
    await api.delete(`/combinations/videos/${id}`);
  },
};
