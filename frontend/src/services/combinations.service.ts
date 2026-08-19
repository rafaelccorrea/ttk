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
  /** De qual produto é o clipe — `null` nos antigos e nos genéricos. */
  produto: string | null;
  url: string;
  sizeBytes: number;
  /** Duração medida no upload. `0` é "não medido" — nunca "vazio". */
  durationMs: number;
  createdAt: string;
}

/**
 * A fórmula 3s / 10s / 5s, replicada de `clip-timing.ts` no backend.
 *
 * `ideal` é o alvo e só gera aviso; passar de `limite` faz o servidor recusar
 * a montagem — a tela avisa antes para o vendedor não descobrir no clique.
 */
export const FAIXAS_DE_DURACAO: Record<
  ClipRole,
  { alvo: number; ideal: { min: number; max: number }; limite: number }
> = {
  hook: { alvo: 3, ideal: { min: 1.5, max: 5 }, limite: 8 },
  body: { alvo: 10, ideal: { min: 5, max: 15 }, limite: 25 },
  cta: { alvo: 5, ideal: { min: 2, max: 8 }, limite: 12 },
};

export type SituacaoDeDuracao =
  | 'ideal'
  | 'fora-da-faixa'
  | 'acima-do-limite'
  | 'desconhecida';

/** Onde a duração deste clipe cai na faixa do bloco dele. */
export function situacaoDaDuracao(
  role: ClipRole,
  durationMs: number,
): SituacaoDeDuracao {
  if (!durationMs) return 'desconhecida';
  const s = durationMs / 1000;
  const faixa = FAIXAS_DE_DURACAO[role];
  if (s > faixa.limite) return 'acima-do-limite';
  if (s < faixa.ideal.min || s > faixa.ideal.max) return 'fora-da-faixa';
  return 'ideal';
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
  /** Pasta escolhida pelo vendedor, ou `null` para "sem pasta". */
  folderId: string | null;
  /**
   * Desempenho lançado — sempre opcional.
   *
   * `null` é "não informado", não "zero": um vídeo sem lançamento não entra
   * em nenhuma média.
   */
  views: number | null;
  sales: number | null;
  postUrl: string | null;
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
  /** Só na visão por pasta: a cor da etiqueta. */
  cor?: string;
}

/** Uma peça (gancho, corpo ou CTA) com o que os vídeos dela renderam. */
export interface PecaInsight {
  indice: number;
  /** `G2`, `C1`, `A3` — o mesmo código do nome do arquivo. */
  codigo: string;
  rotulo: string;
  videos: number;
  /** `null` quando nenhum vídeo desta peça teve views lançadas. */
  mediaViews: number | null;
  totalVendas: number | null;
  /** `true` quando a média vem de poucos vídeos para virar decisão. */
  dadoFraco: boolean;
}

export interface PlanoInsights {
  planId: string;
  sigla: string;
  videosLancados: number;
  videosTotais: number;
  mediaGeralViews: number | null;
  /** Vídeos que uma peça precisa para sair de `dadoFraco`. */
  minimoConfiavel: number;
  blocos: Record<'hook' | 'body' | 'cta', PecaInsight[]>;
}

/** Uma linha do lançamento em massa. Campos ausentes ficam como estão. */
export interface VideoResultInput {
  id: string;
  views?: number | null;
  sales?: number | null;
  postUrl?: string | null;
}

/** Pasta criada pelo vendedor para guardar vídeos montados. */
export interface CombinationFolder {
  id: string;
  name: string;
  /** Hex `#rrggbb` — o servidor recusa qualquer outro formato. */
  color: string;
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

  async uploadClip(
    role: ClipRole,
    file: File,
    produto?: string,
  ): Promise<CombinationClip> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<CombinationClip>('/combinations/clips', form, {
      // `produto` etiqueta o clipe já no upload — a sigla digitada no passo 1.
      params: produto?.trim() ? { role, produto: produto.trim() } : { role },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  /** Edita a etiqueta de produto do clipe. String vazia limpa. */
  async updateClip(id: string, produto: string): Promise<CombinationClip> {
    const { data } = await api.patch<CombinationClip>(
      `/combinations/clips/${id}`,
      { produto },
    );
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

  async listFolders(): Promise<CombinationFolder[]> {
    const { data } = await api.get<CombinationFolder[]>('/combinations/folders');
    return data;
  },

  async createFolder(name: string, color?: string): Promise<CombinationFolder> {
    const { data } = await api.post<CombinationFolder>('/combinations/folders', {
      name,
      color,
    });
    return data;
  },

  async updateFolder(
    id: string,
    patch: { name?: string; color?: string },
  ): Promise<CombinationFolder> {
    const { data } = await api.patch<CombinationFolder>(
      `/combinations/folders/${id}`,
      patch,
    );
    return data;
  },

  /** Apaga a pasta — os vídeos voltam para "sem pasta", nenhum arquivo some. */
  async deleteFolder(id: string): Promise<void> {
    await api.delete(`/combinations/folders/${id}`);
  },

  /** `folderId` null tira os vídeos de qualquer pasta. */
  async moveVideos(videoIds: string[], folderId: string | null): Promise<void> {
    await api.post('/combinations/videos/move', { videoIds, folderId });
  },

  /** Lança o desempenho de um vídeo. `null` num campo apaga o valor. */
  async setResult(
    id: string,
    dados: { views?: number | null; sales?: number | null; postUrl?: string | null },
  ): Promise<CombinationVideo> {
    const { data } = await api.patch<CombinationVideo>(
      `/combinations/videos/${id}/result`,
      dados,
    );
    return data;
  },

  /** Lança vários vídeos de uma vez — a tela de planilha manda tudo junto. */
  async setResults(itens: VideoResultInput[]): Promise<CombinationVideo[]> {
    const { data } = await api.patch<CombinationVideo[]>(
      '/combinations/videos/results',
      { itens },
    );
    return data;
  },

  /** Cria um plano novo contendo só as peças vencedoras deste. */
  async derive(planId: string): Promise<CombinationPlanDetail> {
    const { data } = await api.post<CombinationPlanDetail>(
      `/combinations/${planId}/derive`,
    );
    return data;
  },

  async insights(planId: string): Promise<PlanoInsights> {
    const { data } = await api.get<PlanoInsights>(
      `/combinations/${planId}/insights`,
    );
    return data;
  },
};
