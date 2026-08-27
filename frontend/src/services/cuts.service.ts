import { api } from './api';

export type CutMode = 'rapido' | 'inteligente';
export type CutFormat = '9:16' | '16:9' | '1:1';
/** Espelho de `CAPTION_STYLES` / `REFRAME_MODES` no backend. */
export type CaptionStyle = 'classico' | 'karaoke' | 'impacto' | 'minimal' | 'oferta';
export type ReframeMode = 'rosto' | 'blur';
export type CutJobStatus = 'pendente' | 'processando' | 'pronto' | 'falhou';
export type CutClipStatus = 'pendente' | 'pronto' | 'falhou';

/** Espelho de `LIMITES` em `backend/src/modules/cuts/cut-planner.ts`. */
export const LIMITES_DE_CORTE = {
  fonteMinSeg: 2 * 60,
  fonteMaxSeg: 60 * 60,
  qtdMin: 3,
  qtdMax: 20,
  corteMinSeg: 15,
  corteMaxSeg: 90,
} as const;

export interface CutJob {
  id: string;
  status: CutJobStatus;
  mode: CutMode;
  format: CutFormat;
  captions: boolean;
  captionStyle: CaptionStyle;
  reframe: ReframeMode;
  quantity: number;
  minSeconds: number;
  maxSeconds: number;
  sourceName: string;
  sourceUrl: string | null;
  sourceDurationSeconds: number | null;
  error: string | null;
  createdAt: string;
}

/** O que este servidor oferece — decide se a aba de link e o "seguir rosto" aparecem. */
export interface CutCapabilities {
  urlImport: boolean;
  faceTracking: boolean;
}

/** Prévia de um link antes de confirmar. */
export interface InfoDoLink {
  titulo: string;
  duracaoSeg: number | null;
  thumb: string | null;
  plataforma: string;
  cabe: boolean;
  motivo: string | null;
}

export interface CutJobSummary extends CutJob {
  clipsTotal: number;
  clipsProntos: number;
}

export interface CutClip {
  id: string;
  position: number;
  startSeconds: number;
  endSeconds: number;
  title: string | null;
  hook: string | null;
  reason: string | null;
  /** Nota 0–10 da IA (nula no modo rápido). */
  score: number | null;
  origin: 'ia' | 'rapido';
  captions: boolean;
  url: string | null;
  status: CutClipStatus;
  error: string | null;
}

export interface CutJobDetail extends CutJob {
  clips: CutClip[];
}

export interface CutQuote {
  mode: CutMode;
  quantity: number;
  porCorte: number;
  cortes: number;
  blocosDeTranscricao: number;
  transcricao: number;
  total: number;
}

export interface CreateCutJobInput {
  mode: CutMode;
  format: CutFormat;
  quantity: number;
  minSeconds: number;
  maxSeconds: number;
  /** Queimar legenda (só no modo inteligente). */
  captions?: boolean;
  captionStyle?: CaptionStyle;
  reframe?: ReframeMode;
}

export type ClipRole = 'hook' | 'body' | 'cta';

/** Teto duro por bloco do Multiplicador — espelho de `clip-timing.ts`. */
export const LIMITE_POR_BLOCO: Record<ClipRole, number> = { hook: 8, body: 25, cta: 12 };

export const NOME_DO_BLOCO: Record<ClipRole, string> = {
  hook: 'Gancho',
  body: 'Corpo',
  cta: 'CTA',
};

export const cutsService = {
  async quote(mode: CutMode, quantity: number, durationSeconds?: number): Promise<CutQuote> {
    const { data } = await api.get<CutQuote>('/cuts/quote', {
      params: { mode, quantity, durationSeconds },
    });
    return data;
  },

  async list(): Promise<CutJobSummary[]> {
    const { data } = await api.get<CutJobSummary[]>('/cuts');
    return data;
  },

  async get(id: string): Promise<CutJobDetail> {
    const { data } = await api.get<CutJobDetail>(`/cuts/${id}`);
    return data;
  },

  async create(
    input: CreateCutJobInput,
    file: File,
    onProgress?: (percentual: number) => void,
  ): Promise<CutJob> {
    const form = new FormData();
    form.append('file', file);
    form.append('mode', input.mode);
    form.append('format', input.format);
    form.append('quantity', String(input.quantity));
    form.append('minSeconds', String(input.minSeconds));
    form.append('maxSeconds', String(input.maxSeconds));
    form.append('captions', input.captions ? 'true' : 'false');
    if (input.captionStyle) form.append('captionStyle', input.captionStyle);
    if (input.reframe) form.append('reframe', input.reframe);
    const { data } = await api.post<CutJob>('/cuts', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (evento) => {
        if (!onProgress || !evento.total) return;
        onProgress(Math.round((evento.loaded / evento.total) * 100));
      },
    });
    return data;
  },

  async capabilities(): Promise<CutCapabilities> {
    const { data } = await api.get<CutCapabilities>('/cuts/capabilities');
    return data;
  },

  /** Prévia (título, duração, capa) de um link antes de gerar. */
  async urlInfo(url: string): Promise<InfoDoLink> {
    const { data } = await api.get<InfoDoLink>('/cuts/url-info', { params: { url } });
    return data;
  },

  /** Job a partir de um link; o download acontece no servidor. */
  async createFromUrl(input: CreateCutJobInput & { url: string }): Promise<CutJob> {
    const { data } = await api.post<CutJob>('/cuts/from-url', {
      ...input,
      captions: Boolean(input.captions),
    });
    return data;
  },

  /** Manda um corte pronto para o Multiplicador como gancho/corpo/CTA. */
  async toMultiplier(clipId: string, role: ClipRole, produto?: string): Promise<void> {
    await api.post(`/cuts/clips/${clipId}/multiplier`, { role, produto });
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/cuts/${id}`);
  },
};

/** Duração de um arquivo de vídeo lida no navegador, em segundos (ou null). */
export function lerDuracaoDoVideo(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const fim = (valor: number | null) => {
      URL.revokeObjectURL(url);
      resolve(valor);
    };
    video.onloadedmetadata = () =>
      fim(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => fim(null);
    video.src = url;
  });
}

/**
 * Captura UM quadro do vídeo escolhido (a ~10% da duração, para pular a
 * vinheta) como data URL. É o que alimenta o preview de formato antes de
 * gerar: sem quadro real, o usuário só vê um retângulo e não entende o que
 * "9:16 com fundo desfocado" faz com o vídeo DELE.
 */
export function capturarQuadroDoVideo(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    let terminou = false;
    const fim = (valor: string | null) => {
      if (terminou) return;
      terminou = true;
      URL.revokeObjectURL(url);
      resolve(valor);
    };
    video.onloadedmetadata = () => {
      const alvo = Number.isFinite(video.duration) ? Math.min(video.duration * 0.1, 5) : 0;
      video.currentTime = alvo;
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const escala = Math.min(1, 480 / Math.max(video.videoWidth, 1));
        canvas.width = Math.round(video.videoWidth * escala);
        canvas.height = Math.round(video.videoHeight * escala);
        const ctx = canvas.getContext('2d');
        if (!ctx) return fim(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        fim(canvas.toDataURL('image/jpeg', 0.8));
      } catch {
        fim(null);
      }
    };
    video.onerror = () => fim(null);
    setTimeout(() => fim(null), 8000);
    video.src = url;
  });
}

export function formatarTempo(seg: number): string {
  const total = Math.max(0, Math.round(seg));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
