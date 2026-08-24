/**
 * O contrato do fluxo SSE da transmissão, espelhado do backend.
 *
 * Fonte da verdade: `backend/src/modules/live/live-events.service.ts` (os tipos
 * de evento) e `live-run.controller.ts` (os campos de cada payload, que são
 * montados lá dentro, não numa DTO compartilhada). Como as duas aplicações
 * versionam separado, este arquivo é uma CÓPIA — quem mexer no controller tem
 * que vir aqui atrás, e o compilador não vai avisar.
 *
 * Os campos abaixo saem exatamente dos `this.eventos.publicar(...)` do
 * controller; nada é inventado nem "melhorado" no caminho.
 */

/** `live_runs.status` — ver `entities/live-run.entity.ts`. */
export type LiveRunStatus = 'conectando' | 'ativa' | 'encerrada' | 'erro';

/**
 * A decisão do copiloto sobre a própria resposta. `silenciar` existe no banco
 * mas NUNCA chega ao painel: o controller filtra antes de publicar, porque
 * mostrar o que o modelo mesmo considerou fraco é o jeito mais rápido de o
 * vendedor parar de olhar para a tela.
 */
export type LiveReplyDecision = 'enviar' | 'escalar' | 'silenciar';

export type LiveEventType =
  | 'reply'
  | 'escalation'
  | 'stats'
  | 'delivery'
  | 'mode'
  | 'credits_exhausted'
  | 'duration_limit_reached'
  | 'ended';

/** `live_runs.endReason` — ver `entities/live-run.entity.ts`. */
export type LiveRunEndReason =
  | 'manual'
  | 'limite_duracao'
  | 'creditos'
  | 'aviso_tiktok'
  | 'erro';

/** `live_runs.mode` — ver `entities/live-run.entity.ts`. */
export type LiveRunMode = 'painel' | 'auto';

/** `live_replies.deliveryStatus`. */
export type LiveDeliveryStatus =
  | 'nao_aplica'
  | 'pendente'
  | 'enviada'
  | 'falhou'
  | 'cancelada';

/** Resposta pronta para o vendedor copiar ou ler em voz alta. */
export interface LiveReplyEvent {
  id: string;
  chatMessageId: string;
  /**
   * O HASH de quem perguntou — nunca o @. É o que o card manda de volta no
   * "bloquear autor"; só o processo principal sabe a que nome ele corresponde,
   * e só durante a run em que ele nasceu. Pode vir vazio.
   */
  authorHash: string;
  text: string;
  /**
   * Vem `numeric` do Postgres, que o driver entrega como string; o controller
   * já aplica `Number()` antes de publicar. Aqui chega número.
   */
  confidence: number;
  decision: LiveReplyDecision;
  model: string;
  sourceProductIds: string[];
  latencyMs: number;
}

/** A pergunta subiu para o humano — o modelo não a sustentou, ou o chat repetiu. */
export interface LiveEscalationEvent {
  chatMessageId: string;
  /** Hash do autor, nunca o @ — ver `LiveReplyEvent.authorHash`. */
  authorHash: string;
  text: string;
  repeatCount: number;
  /** Serializado como string ISO na travessia do SSE. */
  receivedAt: string;
}

/** Os contadores da run, para o rodapé do painel. */
export interface LiveStatsEvent {
  runId: string;
  status: LiveRunStatus;
  messagesSeen: number;
  repliesGenerated: number;
  escalations: number;
  minutesCharged: number;
  mode: LiveRunMode;
  repliesSent: number;
  deliveryFailures: number;
  /** Preenchido quando a run terminou; nulo enquanto está no ar. */
  endReason: LiveRunEndReason | null;
}

/**
 * O desfecho do envio de UMA resposta no chat — `POST replies/:id/delivery`
 * republicado no fluxo.
 *
 * Vem do servidor, e não do processo principal, porque o vendedor pode ter a
 * live aberta no app e a conta aberta na web: quem confirmou a entrega foi o
 * app, mas quem sabe o estado final da resposta é o banco. O painel desenha o
 * que o backend confirmou, nunca o que ele mesmo torceu para ter acontecido.
 */
export interface LiveDeliveryEvent {
  replyId: string;
  deliveryStatus: LiveDeliveryStatus;
  /** ISO na travessia do SSE; nulo enquanto não saiu. */
  sentAt: string | null;
  /** Em português e pronto para a tela quando `deliveryStatus === 'falhou'`. */
  failureReason: string | null;
}

/** A run trocou de modo — inclusive quando quem trocou foi a outra janela. */
export interface LiveModeEvent {
  runId: string;
  mode: LiveRunMode;
}

/** Acabaram os minutos de live: a transmissão parou por saldo. */
export interface LiveCreditsExhaustedEvent {
  runId: string;
  /** `live_runs.errorMessage`; pode vir nulo se a run já estava encerrada. */
  motivo: string | null;
}

/**
 * A run bateu o teto de duração do plano e foi encerrada pelo servidor. Fim
 * NORMAL, não erro — o `ended` vem logo atrás no mesmo fluxo.
 */
export interface LiveDurationLimitEvent {
  runId: string;
  /** Minutos que a transmissão durou (o teto do plano, na prática). */
  minutos: number;
}

/** Último evento do fluxo. Depois dele o canal fecha. */
export interface LiveEndedEvent extends LiveStatsEvent {
  motivo: string;
  endedAt: string | null;
}

/**
 * União discriminada por `type`. É o que permite ao painel tratar o evento sem
 * cast: um `switch` sobre `type` estreita o `data` sozinho.
 */
export type LiveEvent =
  | { type: 'reply'; data: LiveReplyEvent }
  | { type: 'escalation'; data: LiveEscalationEvent }
  | { type: 'stats'; data: LiveStatsEvent }
  | { type: 'delivery'; data: LiveDeliveryEvent }
  | { type: 'mode'; data: LiveModeEvent }
  | { type: 'credits_exhausted'; data: LiveCreditsExhaustedEvent }
  | { type: 'duration_limit_reached'; data: LiveDurationLimitEvent }
  | { type: 'ended'; data: LiveEndedEvent };

/**
 * Uma mensagem de chat no formato que o backend aceita em
 * `POST /live/runs/:id/messages`.
 *
 * `authorHash` e não o nome do espectador: o backend só precisa distinguir
 * autores para deduplicar e contar repetição, e guardar identidade de terceiro
 * que nunca consentiu seria coletar dado pessoal sem uso.
 */
export interface ChatMessagePayload {
  externalMessageId: string;
  authorHash: string;
  text: string;
  /** ISO. Omitido, o backend carimba a hora de chegada dele. */
  receivedAt?: string;
  /** Veio do cartão de pergunta do TikTok (`questionNew`); só quando `true`. */
  isQuestion?: boolean;
}
