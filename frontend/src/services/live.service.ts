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
  /** Texto livre que ensina a IA: garantia, material, medidas, o que vem na caixa. */
  details: string | null;
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
/**
 * O que a importação devolve.
 *
 * `ignoradas` não é detalhe: uma planilha de 300 linhas que importa 297 precisa
 * dizer quais três ficaram de fora e por quê. Devolver só o total de sucesso
 * faria o vendedor acreditar que está tudo lá — e descobrir o contrário quando
 * o copiloto não soubesse responder sobre um produto ao vivo.
 */
/** Uma transmissão passada, com o que aconteceu nela. */
export interface LiveRunResumo {
  id: string;
  status: string;
  mode: string;
  startedAt: string | null;
  endedAt: string | null;
  knowledgeSessionId: string;
  messagesSeen: number;
  repliesGenerated: number;
  escalations: number;
  repliesSent: number;
  deliveryFailures: number;
  minutesCharged: number;
  repliesUsed: number;
  /**
   * `null` quando não houve resposta nenhuma.
   *
   * Não é zero: "nenhuma resposta gerada" e "nenhuma das respostas prestou" são
   * coisas diferentes, e mostrar as duas como 0% acusaria o copiloto de um
   * fracasso que não houve.
   */
  usageRate: number | null;
  latencyP50Ms: number | null;
  /** Audiência agregada pelo app durante a transmissão. Zero em lives antigas,
   * de antes de o desktop capturar audiência. */
  peakViewers: number;
  totalLikes: number;
  totalGifts: number;
  totalGiftDiamonds: number;
  totalFollows: number;
  totalShares: number;
}

/** Um instantâneo de audiência (~30s). Contadores são deltas da janela. */
export interface LiveRunMetricPoint {
  capturedAt: string;
  /** Nulo quando o webcast não entregou a leitura naquela janela. */
  viewerCount: number | null;
  likes: number;
  gifts: number;
  giftDiamonds: number;
  follows: number;
  shares: number;
  joins: number;
}

/**
 * Uma pergunta do chat e o que o copiloto fez com ela. `answer` nula é uma
 * escalação que ficou sem resposta — a lacuna que o vendedor precisa rever.
 */
export interface LiveRunQa {
  chatMessageId: string;
  question: string;
  /** Quantas pessoas fizeram esta mesma pergunta (cluster). */
  repeatCount: number;
  receivedAt: string;
  answer: string | null;
  decision: 'enviar' | 'escalar';
  confidence: number | null;
  latencyMs: number | null;
  copiedAt: string | null;
  deliveryStatus: 'nao_aplica' | 'pendente' | 'enviada' | 'falhou' | 'cancelada';
  sentAt: string | null;
  failureReason: string | null;
}

export interface LiveRunDetail extends LiveRunResumo {
  tiktokUsername: string | null;
  metricas: LiveRunMetricPoint[];
  qa: LiveRunQa[];
}

export interface ResultadoDaImportacao {
  criados: number;
  atualizados: number;
  ignoradas: Array<{ linha: number; motivo: string }>;
}

export interface ProdutoInput {
  name?: string;
  priceBrl?: number | null;
  variants?: string[];
  shippingInfo?: string;
  promo?: string;
  details?: string;
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

/**
 * Piso de duração aceito pelo pipeline, em minutos — espelha `LIVE_MIN_MINUTES`
 * do backend. Abaixo disso a gravação não tem conversa suficiente para virar
 * base, e a recusa acontece aqui para o arquivo não subir à toa.
 */
export const LIVE_MIN_MINUTES = 10;

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

  /** Histórico das transmissões, com aproveitamento e latência. */
  listRuns: () => api.get<LiveRunResumo[]>('/live/runs').then((r) => r.data),

  /** Uma transmissão inteira: métricas de audiência, perguntas e respostas. */
  getRun: (id: string) =>
    api.get<LiveRunDetail>(`/live/runs/${id}`).then((r) => r.data),

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

  /**
   * Importa o catálogo de um CSV.
   *
   * O nome do produto é a chave: reimportar a planilha corrigida atualiza os
   * preços em vez de duplicar a base.
   */
  importarCatalogo: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<ResultadoDaImportacao>(
        `/live/sessions/${sessionId}/products/import`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      .then((r) => r.data);
  },

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
  /*
   * Vem de `/app/download.json`, um arquivo ESTÁTICO gerado pelo build do
   * frontend (ver `scripts/copiar-app-desktop.mjs`) e publicado junto com o
   * instalador — não do backend. A versão e o link nascem do mesmo build que
   * empacota o `.exe`, então não existe o estado "subiu o instalador novo mas o
   * site anuncia o antigo". O 404 é o estado normal enquanto não há release
   * (e em dev, onde o `dist/app` não existe): vira "em breve" no card.
   */
  getDownload: (): Promise<DownloadDoApp> =>
    // `no-store` porque este arquivo MUDA a cada release mantendo a mesma URL:
    // sem isso o navegador reusa o JSON em cache e o site anuncia (e baixa) a
    // versão anterior até o cache expirar. O `.exe` não precisa disso — o nome
    // dele carrega a versão, então cada release é uma URL nova.
    fetch('/app/download.json', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`download.json: ${r.status}`);
        return r.json() as Promise<DownloadDoApp>;
      })
      .catch(() => ({
        disponivel: false,
        versao: null,
        windows: null,
        mac: null,
        assinado: false,
      })),
};
