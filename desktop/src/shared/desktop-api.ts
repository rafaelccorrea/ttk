/**
 * O contrato entre o painel (renderer) e o processo principal.
 *
 * Mora em `shared/` e não dentro do preload porque os dois lados precisam dos
 * MESMOS tipos: o preload para tipar o que expõe, o painel para consumir. Os
 * formatos abaixo são o que o processo principal devolve DEPOIS de falar com o
 * backend — não são a resposta crua da API. A diferença importa: o painel não
 * conhece URL, token nem header, e é exatamente por isso que o token do
 * vendedor nunca precisa existir dentro do renderer.
 *
 * Quem for mexer aqui mexe nos dois lados. O compilador cobra o preload, mas
 * não cobra o backend — as rotas de origem estão anotadas em cada tipo para
 * que a busca comece no lugar certo.
 */

/**
 * Onde a ativação está.
 *
 * `pendente` é o estado normal enquanto o vendedor autoriza no navegador; o
 * painel fica nele até o processo principal terminar o polling do
 * `POST /auth/device/token`. `expirado` e `negado` são desfechos distintos de
 * propósito: um pede "gerar outro código", o outro pede "você recusou, foi
 * engano?", e tratar os dois como uma falha genérica deixaria o vendedor sem
 * saber qual dos dois botões apertar.
 */
export type StatusAtivacao =
  | 'ociosa'
  | 'pendente'
  | 'aprovada'
  | 'negada'
  | 'expirada'
  | 'erro';

/** `POST /auth/device/start` mais o desfecho do polling. */
export interface EstadoAtivacao {
  status: StatusAtivacao;
  /** PIKPOK-XXXX. Nulo enquanto nenhum código foi pedido. */
  userCode: string | null;
  /** A página do site que aprova o código, com ele já preenchido. */
  verificationUrl: string | null;
  /** Segundos de vida do código, para o contador da tela. */
  expiresIn: number | null;
  /** Mensagem pronta para exibição quando `status === 'erro'`. */
  erro: string | null;
}

/** Quem está logado, para o painel dizer em qual conta ele está. */
export interface SessaoDesktop {
  email: string;
  /** `app_users.plan`. O copiloto exige 'business'. */
  plano: string;
}

/**
 * Uma base de conhecimento pronta — `GET /live/sessions` já filtrado.
 *
 * Só chega aqui o que está com `status === 'pronta'`: uma base em
 * transcrição ou em rascunho responderia a live com metade dos produtos, e
 * "responder errado" é pior do que "não responder".
 */
export interface BaseDeConhecimento {
  id: string;
  title: string;
  produtos: number;
  faqs: number;
  /** ISO. Serve para o vendedor reconhecer qual gravação é qual. */
  atualizadaEm: string | null;
}

/** O recorte de live do `GET /billing/wallet`. */
export interface CarteiraLive {
  minutos: number;
  trialMinutos: number;
  trialDisponivel: boolean;
}

/** Estado da conexão com o chat, do ponto de vista do painel. */
export type StatusConexao =
  | 'desconectado'
  | 'conectando'
  | 'ativa'
  | 'pausada'
  | 'sem_saldo'
  | 'encerrada'
  | 'erro';

export interface EstadoConexao {
  status: StatusConexao;
  runId: string | null;
  /** @lojadaana, para o cabeçalho do cockpit. */
  tiktokUsername: string | null;
  /** Título da base em uso, para o vendedor confirmar de relance. */
  baseTitulo: string | null;
  /** Mensagem pronta quando `status` é 'erro' ou 'sem_saldo'. */
  motivo: string | null;
}

/**
 * Os ajustes do copiloto, guardados em disco pelo processo principal
 * (electron-store) e aplicados por ele ao montar cada lote.
 *
 * Ficam no cliente, e não no backend, porque são preferências de operação de
 * quem está no ar — o vendedor mexe nelas no meio da live, quando percebe que
 * o copiloto está falando demais ou de menos, e uma ida ao servidor no meio
 * disso só adiciona uma forma de a mudança não valer.
 */
export interface ConfiguracoesCopiloto {
  /** Acima disso a resposta entra em "prontas". 0–1. */
  limiarResposta: number;
  /** Abaixo disso a pergunta nem vira rascunho: some. 0–1. */
  limiarDescarte: number;
  /** Palavras que fazem a mensagem ser ignorada antes de custar modelo. */
  listaNegra: string[];
  /** Quantas mensagens o desktop junta antes de mandar um lote. */
  tamanhoDoLote: number;
}

/** Limites que a tela de configurações mostra e o preload não deixa passar. */
export const LOTE_MINIMO = 1;
export const LOTE_MAXIMO = 40;

/** O que o painel enxerga do processo principal. Deve crescer devagar. */
export interface PikPokDesktopApi {
  /** Versão do app, para o rodapé e para os relatos de erro. */
  readonly obterVersao: () => Promise<string>;
  /** Plataforma, para os atalhos de teclado do painel (Cmd vs Ctrl). */
  readonly plataforma: NodeJS.Platform;

  // ------------------------------------------------------------- ativação
  /** Pede um código novo e começa o polling no processo principal. */
  readonly iniciarAtivacao: () => Promise<EstadoAtivacao>;
  /** Assina o estado da ativação; devolve a função que cancela a assinatura. */
  readonly aoMudarAtivacao: (
    ouvinte: (estado: EstadoAtivacao) => void,
  ) => () => void;
  /** Sessão atual, ou `null` se o app ainda não foi ativado. */
  readonly obterSessao: () => Promise<SessaoDesktop | null>;
  /** Esquece o token guardado e volta para a tela de ativação. */
  readonly sair: () => Promise<void>;
  /** Abre a URL no navegador do sistema (nunca numa janela do app). */
  readonly abrirNoNavegador: (url: string) => Promise<void>;

  // -------------------------------------------------------------- conexão
  readonly listarBases: () => Promise<BaseDeConhecimento[]>;
  readonly obterCarteiraLive: () => Promise<CarteiraLive>;
  readonly conectar: (params: {
    knowledgeSessionId: string;
    tiktokUsername: string;
  }) => Promise<EstadoConexao>;
  readonly encerrar: (motivo?: string) => Promise<EstadoConexao>;
  /** Liga/desliga o processamento sem derrubar a run nem parar a cobrança. */
  readonly pausar: (pausado: boolean) => Promise<EstadoConexao>;
  readonly obterConexao: () => Promise<EstadoConexao>;
  readonly aoMudarConexao: (
    ouvinte: (estado: EstadoConexao) => void,
  ) => () => void;

  // --------------------------------------------------------------- eventos
  /**
   * O fluxo da run (reply, escalation, stats, credits_exhausted, ended), que o
   * processo principal recebe por SSE e repassa. Devolve o cancelador.
   */
  readonly aoReceberEvento: (
    ouvinte: (evento: import('./live-events').LiveEvent) => void,
  ) => () => void;

  /** Copia para a área de transferência e avisa `POST /live/replies/:id/copied`. */
  readonly copiarResposta: (replyId: string, texto: string) => Promise<void>;
  /** Copia um rascunho de escalação — não há id de resposta para carimbar. */
  readonly copiarTexto: (texto: string) => Promise<void>;
  /** O vendedor respondeu na voz: tira o card da fila e registra o desfecho. */
  readonly resolverEscalacao: (
    chatMessageId: string,
    desfecho: 'respondida' | 'descartada',
  ) => Promise<void>;

  // --------------------------------------------------------- configurações
  readonly lerConfiguracoes: () => Promise<ConfiguracoesCopiloto>;
  readonly salvarConfiguracoes: (
    valores: ConfiguracoesCopiloto,
  ) => Promise<ConfiguracoesCopiloto>;
}
