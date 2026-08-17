import { api } from './api';

/**
 * Estados do pipeline, na ordem em que a sessão anda. Só `transcrevendo` e
 * `extraindo` são de trabalho em andamento — é por eles que a tela decide se
 * ainda precisa perguntar o status ao backend.
 */
export type LiveSessionStatus =
  | 'rascunho'
  | 'transcrevendo'
  | 'extraindo'
  | 'pronta'
  | 'erro';

export type LiveSessionSourceKind = 'gravada' | 'manual';

/** Quem colocou a linha na base — é o que o vendedor precisa conferir. */
export type LiveOrigin = 'ia' | 'manual' | 'catalogo';

export type LiveFaqKind = 'faq' | 'objecao' | 'politica';

export interface LiveSession {
  id: string;
  title: string;
  status: LiveSessionStatus;
  sourceKind: LiveSessionSourceKind;
  durationSeconds: number | null;
  creditsSpent: number;
  errorMessage: string | null;
  /** Quando a etapa atual começou; alimenta o "está rodando há X min". */
  processingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `priceBrl` e `confidence` chegam como STRING: são `numeric` no Postgres e o
 * driver não os converte para number para não perder precisão. Tipar como
 * number aqui faria `toFixed` funcionar em dev e quebrar em runtime — então o
 * tipo diz a verdade e a tela converte onde precisa.
 */
export interface LiveProduct {
  id: string;
  liveSessionId: string;
  name: string;
  priceBrl: string | null;
  variants: unknown[];
  shippingInfo: string | null;
  promo: string | null;
  aliases: string[];
  confidence: string | null;
  origin: LiveOrigin;
  sourceStartSec: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LiveFaq {
  id: string;
  liveSessionId: string;
  liveProductId: string | null;
  question: string;
  answer: string;
  kind: LiveFaqKind;
  origin: LiveOrigin;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface LiveSessionDetail extends LiveSession {
  produtos: LiveProduct[];
  faq: LiveFaq[];
}

/**
 * O que a tela pode mandar num produto.
 *
 * `origin`, `confidence` e `sourceStartSec` ficam de fora porque o backend não
 * os aceita: eles contam de onde a linha veio, e procedência não é campo de
 * formulário.
 */
export interface ProdutoInput {
  name?: string;
  priceBrl?: number | null;
  variants?: string[];
  shippingInfo?: string;
  promo?: string;
  aliases?: string[];
  active?: boolean;
}

export interface FaqInput {
  question?: string;
  answer?: string;
  kind?: LiveFaqKind;
  liveProductId?: string | null;
  priority?: number;
}

/**
 * O instalador do app de desktop.
 *
 * `disponivel: false` não é erro: é o estado normal enquanto não houver release
 * publicado, e a tela mostra "em breve" em vez de um botão que baixa 404.
 */
export interface DownloadDoApp {
  disponivel: boolean;
  versao: string | null;
  windows: string | null;
  mac: string | null;
  /** Sem assinatura, o Windows exibe o aviso do SmartScreen na instalação. */
  assinado: boolean;
}

/** Bloco de cobrança da transcrição, em minutos (espelha o backend). */
export const TRANSCRIBE_BLOCK_MINUTES = 10;

/** Teto de duração aceito pelo pipeline, em minutos. */
export const TRANSCRIBE_MAX_MINUTES = 300;

/** Teto do upload — acima disso o backend recusa antes de ler o arquivo. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Preços de tabela, usados só como rede se a carteira não responder. */
export const PRECO_PADRAO = { transcribe: 6, live_extract: 17 } as const;

/** Blocos cobrados para uma duração em segundos (sempre ≥ 1). */
export function blocosDeTranscricao(durationSeconds: number): number {
  const minutos = durationSeconds / 60;
  return Math.max(Math.ceil(minutos / TRANSCRIBE_BLOCK_MINUTES), 1);
}

/**
 * Quanto a extração vai custar, para mostrar ANTES de o upload começar.
 *
 * O backend cobra transcrição por bloco de 10 minutos começado, mais uma taxa
 * única da extração. Quando a duração ainda não é conhecida (o navegador não
 * conseguiu ler os metadados do arquivo), devolve o mínimo de um bloco — que é
 * o piso, e por isso a tela mostra "a partir de".
 */
export function estimarCreditos(
  durationSeconds: number | null,
  precos: { transcribe: number; live_extract: number } = PRECO_PADRAO,
): { creditos: number; blocos: number; exato: boolean } {
  const blocos = blocosDeTranscricao(durationSeconds ?? 0);
  return {
    creditos: precos.transcribe * blocos + precos.live_extract,
    blocos,
    exato: durationSeconds != null && durationSeconds > 0,
  };
}

/**
 * Lê a duração do arquivo no próprio navegador.
 *
 * Serve só para o aviso de crédito: quem cobra é o backend, depois do ffmpeg.
 * Um container que o `<video>` não sabe abrir (mkv, por exemplo) resolve com
 * `null` em vez de rejeitar — o upload continua valendo, o aviso é que fica
 * menos preciso.
 */
export function lerDuracaoLocal(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement('video');
    const encerrar = (valor: number | null) => {
      URL.revokeObjectURL(url);
      media.removeAttribute('src');
      resolve(valor);
    };
    media.preload = 'metadata';
    media.onloadedmetadata = () =>
      encerrar(Number.isFinite(media.duration) ? media.duration : null);
    media.onerror = () => encerrar(null);
    media.src = url;
  });
}

export const liveService = {
  // ---------------------------------------------------------------- sessões
  listSessions: () =>
    api.get<LiveSession[]>('/live/sessions').then((r) => r.data),

  getSession: (id: string) =>
    api.get<LiveSessionDetail>(`/live/sessions/${id}`).then((r) => r.data),

  createSession: (title: string) =>
    api.post<LiveSession>('/live/sessions', { title }).then((r) => r.data),

  deleteSession: (id: string) => api.delete(`/live/sessions/${id}`).then(() => undefined),

  /**
   * Sobe a gravação. Responde assim que o backend aceita o arquivo — o
   * processamento continua em background, e daí em diante quem informa é o
   * `status` da sessão.
   */
  upload: (
    id: string,
    file: File,
    onProgress?: (percentual: number) => void,
  ) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<LiveSession>(`/live/sessions/${id}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evento) => {
          if (!onProgress || !evento.total) return;
          onProgress(Math.round((evento.loaded / evento.total) * 100));
        },
      })
      .then((r) => r.data);
  },

  // --------------------------------------------------------------- produtos
  createProduct: (sessionId: string, dto: ProdutoInput & { name: string }) =>
    api
      .post<LiveProduct>(`/live/sessions/${sessionId}/products`, dto)
      .then((r) => r.data),

  updateProduct: (id: string, dto: ProdutoInput) =>
    api.patch<LiveProduct>(`/live/products/${id}`, dto).then((r) => r.data),

  deleteProduct: (id: string) =>
    api.delete(`/live/products/${id}`).then(() => undefined),

  // -------------------------------------------------------------------- FAQ
  createFaq: (
    sessionId: string,
    dto: FaqInput & { question: string; answer: string },
  ) => api.post<LiveFaq>(`/live/sessions/${sessionId}/faq`, dto).then((r) => r.data),

  updateFaq: (id: string, dto: FaqInput) =>
    api.patch<LiveFaq>(`/live/faq/${id}`, dto).then((r) => r.data),

  deleteFaq: (id: string) => api.delete(`/live/faq/${id}`).then(() => undefined),

  // ------------------------------------------------------------- app desktop
  getDownload: () =>
    api.get<DownloadDoApp>('/live/download').then((r) => r.data),
};
