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

/**
 * Onde está a atualização automática do app.
 *
 * `baixando` e `pronta` são estados de FUNDO: nada na tela bloqueia por causa
 * deles, porque a instalação acontece quando o vendedor fechar o app. `falhou`
 * existe para o rodapé e para o suporte, não para alarmar — ver
 * `src/main/atualizador.ts`.
 */
export interface EstadoAtualizacao {
  /** `atualizada` = a última checagem confirmou que não há versão nova. */
  situacao: 'ociosa' | 'baixando' | 'pronta' | 'falhou' | 'atualizada';
  /** A versão que está vindo, quando já se sabe qual é. */
  versao: string | null;
  erro: string | null;
}

/**
 * Um evento de audiência da sala, espelho do `AudienceEvent` da fonte de chat
 * (`main/tiktok-chat.ts`) — números da sala, nunca identidade de espectador.
 */
export type EventoDeAudiencia =
  | { kind: 'viewers'; value: number }
  | { kind: 'likes'; value: number }
  | { kind: 'gift'; count: number; diamonds: number }
  | { kind: 'follow' }
  | { kind: 'share' }
  | { kind: 'join' };

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
  /**
   * Conta da equipe/admin: o backend não desconta minuto dela (`unlimited`
   * da carteira). Sem isto a tela via "0 min" e bloqueava justamente a conta
   * que mais entra em live para testar.
   */
  ilimitada: boolean;
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
  /**
   * A run é de mentira: chat roteirizado no lugar do webcast, entrega sem
   * tocar o TikTok. A IA, o backend e a cobrança continuam reais — é o modo
   * de conhecer o produto sem estar transmitindo.
   */
  simulada: boolean;
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
/**
 * A largura do painel da direita, em px. O padrão é FIXO (não uma fração da
 * janela): o cockpit tem uma largura em que fica legível, e ela não muda
 * porque o vendedor maximizou a janela num monitor largo — o que cresce é o
 * vídeo. O vendedor arrasta a divisória para mudar; o valor fica no disco.
 */
export const LARGURA_PAINEL_PADRAO = 640;
export const LARGURA_PAINEL_MINIMA = 460;
/** Fração máxima da janela que o painel pode tomar — o vídeo nunca some. */
export const FRACAO_MAXIMA_DO_PAINEL = 0.7;

/** O que o detector de aviso do TikTok conta à tela — ver `warning-detector`. */
export interface AvisoDoTikTok {
  /** Resumo do texto do banner, truncado no processo principal. */
  texto: string;
  /** O que o app fez: pausou o envio, ou encerrou a live (opt-in). */
  acao: 'pausado' | 'encerrado';
}

/** Um produto da base conectada, o suficiente para a lista de fixar. */
export interface ProdutoDaLive {
  id: string;
  title: string;
  /** Em reais; `null` quando a base não tem preço. */
  priceBrl: number | null;
  /** URL ABSOLUTA da foto (o main já resolveu a origem da API), ou `null`. */
  imageUrl: string | null;
}

export interface ConfiguracoesCopiloto {
  /** Acima disso a resposta entra em "prontas". 0–1. */
  limiarResposta: number;
  /** Abaixo disso a pergunta nem vira rascunho: some. 0–1. */
  limiarDescarte: number;
  /** Palavras que fazem a mensagem ser ignorada antes de custar modelo. */
  listaNegra: string[];
  /** Quantas mensagens o desktop junta antes de mandar um lote. */
  tamanhoDoLote: number;
  /**
   * Espectadores que o vendedor bloqueou (por @). A mensagem deles é
   * descartada ANTES do anonimizador — nunca vira lote, custo nem resposta.
   * A lista vive só neste computador, no electron-store: é escolha do
   * vendedor sobre o chat DELE, e não sobe ao backend.
   */
  usuariosBloqueados: string[];
  /** Roda a fila de produtos da base, fixando o próximo a cada intervalo. */
  rotacaoDeProdutosAtiva: boolean;
  /** Minutos entre uma fixação e a próxima (2–60). */
  rotacaoIntervaloMinutos: number;
  /** Varre a live à procura do banner de aviso do TikTok. Ligado por padrão. */
  detectorAvisoAtivo: boolean;
  /**
   * Ao detectar um aviso, ENCERRA a transmissão (clique no botão do TikTok)
   * além de pausar o envio. Desligado por padrão — encerrar a live do vendedor
   * é a ação mais drástica do app, e um falso positivo aqui custa a venda da
   * noite; ligar é decisão consciente, com aviso na tela de configurações.
   */
  encerrarAoDetectarAviso: boolean;
}

/**
 * O termo de risco do envio automático — `GET /live/termo-envio-automatico`.
 *
 * O texto vem do servidor e não fica escrito na tela por um motivo prático: o
 * aceite é gravado COM A VERSÃO do que a pessoa leu, e um texto compilado dentro
 * do app significaria que a versão registrada é a do release instalado, não a do
 * aviso vigente. Quando a redação mudar, quem já aceitou precisa ler de novo — e
 * é o backend que decide isso.
 */
export interface TermoDeEnvio {
  versao: string;
  texto: string;
  aceito: boolean;
}

/**
 * O estado do envio automático, do ponto de vista da tela.
 *
 * É separado do `EstadoConexao` porque responde a outra pergunta. A conexão diz
 * se o copiloto está LENDO o chat; isto diz se ele está ESCREVENDO nele — e a
 * segunda é a que pode custar a conta do vendedor. Misturar as duas numa
 * estrutura só produziria, mais cedo ou mais tarde, uma tela verde de "tudo
 * certo" enquanto o envio já tinha caído.
 */
export interface EstadoEnvio {
  /** `live_runs.mode`. `painel` é o padrão e o lugar seguro. */
  modo: import('./live-events').LiveRunMode;
  /** O termo já foi aceito por esta conta? Sem isso o backend recusa `auto`. */
  aceito: boolean;
  /** A pausa global (botão e Ctrl+Shift+P). Vale só para o ENVIO. */
  pausado: boolean;
  /** Intervalo mínimo entre duas mensagens, para a linha de "o que vai acontecer". */
  cadenciaSegundos: number;
  /** Teto de mensagens por minuto, da mesma linha. */
  maxPorMinuto: number;
  /**
   * Por que o app caiu sozinho para somente-painel (seletor quebrado, kill
   * switch), em português e pronto para a faixa de aviso. `null` quando não
   * houve queda.
   *
   * É o campo mais importante desta estrutura: o pior estado possível deste
   * produto é o vendedor achar que o copiloto está respondendo o chat enquanto
   * ele parou — e este texto é o que impede isso.
   */
  degradacao: string | null;
}

/**
 * O piso de seguidores que o TikTok pede para liberar a live.
 *
 * É a regra pública deles, não nossa, e pode mudar sem aviso — por isso ela só
 * alimenta um AVISO na tela de conectar, nunca um bloqueio. Se o TikTok baixar
 * o piso amanhã, o pior que acontece é o app dar um conselho desatualizado; se
 * fosse bloqueio, ele impediria uma live perfeitamente possível.
 */
export const MINIMO_SEGUIDORES_LIVE = 1000;

/** Limites que a tela de configurações mostra e o preload não deixa passar. */
export const LOTE_MINIMO = 1;
export const LOTE_MAXIMO = 40;

/** O que o painel enxerga do processo principal. Deve crescer devagar. */
export interface PikPokDesktopApi {
  /** Versão do app, para o rodapé e para os relatos de erro. */
  readonly obterVersao: () => Promise<string>;
  /** Plataforma, para os atalhos de teclado do painel (Cmd vs Ctrl). */
  readonly plataforma: NodeJS.Platform;

  // --------------------------------------------------------------- TikTok
  /**
   * Se há sessão do TikTok viva na BrowserView.
   *
   * O painel não enxerga dentro da view — esta é a única janela que ele tem
   * para o outro lado da tela, e serve para não oferecer uma live que o
   * copiloto não teria como ler nem responder.
   */
  readonly tiktokLogado: () => Promise<boolean>;
  /** Assina login, logout e expiração da sessão do TikTok. */
  readonly aoMudarTikTok: (ouvinte: (logado: boolean) => void) => () => void;
  /**
   * Seguidores da conta, lidos do perfil público, ou `null` quando não der.
   *
   * Serve para uma coisa só: avisar que provavelmente falta seguidor para o
   * TikTok liberar a live. NÃO é veredito de elegibilidade — idade, região e
   * restrições de conta também contam e não são consultáveis — e por isso nada
   * na tela deve ser BLOQUEADO com base nele.
   */
  readonly seguidoresDoTikTok: (usuario: string) => Promise<number | null>;
  /**
   * O @ da conta logada na view do TikTok, ou `null` quando não der para ler.
   *
   * Serve para pré-preencher o campo do @ na tela de conectar — quem transmite
   * é quase sempre a conta logada ao lado. É palpite editável, nunca trava:
   * `null` só significa que o vendedor digita como sempre digitou.
   */
  readonly usuarioDoTikTok: () => Promise<string | null>;
  /**
   * A transmissão do @ está no ar agora? `null` quando não deu para ler.
   *
   * É a mesma leitura que protege a cobrança no processo principal, exposta
   * para a tela de conectar poder ESPERAR a live começar em vez de devolver um
   * erro: quem clica antes de entrar no ar vê um passo a passo e o app conecta
   * sozinho quando detectar a transmissão. `null` é "não sei" — a tela trata
   * como o processo principal trata: não barra ninguém.
   */
  readonly aoVivoNoTikTok: (usuario: string) => Promise<boolean | null>;

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

  // ---------------------------------------------------------- atualização
  readonly obterEstadoAtualizacao: () => Promise<EstadoAtualizacao>;
  readonly aoMudarAtualizacao: (
    ouvinte: (estado: EstadoAtualizacao) => void,
  ) => () => void;
  /** Fecha o app, aplica o pacote já baixado e reabre. Pedido pelo vendedor. */
  readonly instalarAtualizacao: () => Promise<void>;
  /**
   * Checa AGORA se há versão nova, sem esperar o ciclo de 6h. É o botão
   * "verificar atualização" dos ajustes; o download continua automático.
   */
  readonly verificarAtualizacao: () => Promise<EstadoAtualizacao>;

  // -------------------------------------------------------------- conexão
  readonly listarBases: () => Promise<BaseDeConhecimento[]>;
  readonly obterCarteiraLive: () => Promise<CarteiraLive>;
  readonly conectar: (params: {
    knowledgeSessionId: string;
    tiktokUsername: string;
    /** Live de teste: chat roteirizado, IA e cobrança reais — ver EstadoConexao. */
    simulada?: boolean;
  }) => Promise<EstadoConexao>;
  readonly encerrar: (motivo?: string) => Promise<EstadoConexao>;
  /** Liga/desliga o processamento sem derrubar a run nem parar a cobrança. */
  readonly pausar: (pausado: boolean) => Promise<EstadoConexao>;
  readonly obterConexao: () => Promise<EstadoConexao>;
  readonly aoMudarConexao: (
    ouvinte: (estado: EstadoConexao) => void,
  ) => () => void;

  // ------------------------------------------------------- envio automático
  readonly obterEstadoEnvio: () => Promise<EstadoEnvio>;
  readonly aoMudarEnvio: (ouvinte: (estado: EstadoEnvio) => void) => () => void;
  /** Texto e versão do aviso de risco, mais o que esta conta já aceitou. */
  readonly obterTermoDeEnvio: () => Promise<TermoDeEnvio>;
  /** Registra o aceite. A versão volta do termo exibido, nunca é inventada aqui. */
  readonly aceitarTermoDeEnvio: (versao: string) => Promise<EstadoEnvio>;
  /** Troca o modo da run em curso. Rejeita se o backend recusar (sem aceite, kill switch). */
  readonly definirModoDeEnvio: (
    modo: import('./live-events').LiveRunMode,
  ) => Promise<EstadoEnvio>;
  /**
   * A pausa global do ENVIO — o botão vermelho e o Ctrl+Shift+P. Não encerra a
   * run nem para a leitura do chat: o painel continua inteiro.
   */
  readonly pausarEnvio: (pausado: boolean) => Promise<EstadoEnvio>;

  // --------------------------------------------------------------- eventos
  /**
   * O fluxo da run (reply, escalation, stats, credits_exhausted, ended), que o
   * processo principal recebe por SSE e repassa. Devolve o cancelador.
   */
  readonly aoReceberEvento: (
    ouvinte: (evento: import('./live-events').LiveEvent) => void,
  ) => () => void;

  /**
   * O detector viu um banner de aviso/restrição do TikTok na live. O envio já
   * foi pausado (ou a live encerrada, se o opt-in estiver ligado) quando este
   * evento chega — a tela só precisa CONTAR o que aconteceu.
   */
  readonly aoAvisoDoTikTok: (
    ouvinte: (aviso: AvisoDoTikTok) => void,
  ) => () => void;

  // ---------------------------------------------------------------- produtos
  /** Os produtos da base conectada, para a lista de "fixar na live". */
  readonly listarProdutosDaLive: () => Promise<ProdutoDaLive[]>;
  /**
   * Tenta fixar o produto no painel do TikTok Shop — best-effort: `ok: false`
   * vem com um `motivo` pronto para a tela ("fixe manualmente...").
   */
  readonly fixarProduto: (
    titulo: string,
  ) => Promise<{ ok: boolean; motivo?: string }>;
  /**
   * Bloqueia quem escreveu a mensagem por trás do hash — o "bloquear autor"
   * dos cards do cockpit. O renderer só conhece o hash; o @ é resolvido no
   * processo principal e entra em `usuariosBloqueados` sem nunca atravessar o
   * IPC. `ok: false` vem com `motivo` pronto para a tela (hash de mensagem
   * antiga ou de outra live, que a run atual não sabe traduzir).
   */
  readonly bloquearAutor: (
    authorHash: string,
  ) => Promise<{ ok: boolean; motivo?: string }>;
  /** A rotação automática parou sozinha (3 falhas seguidas) — aviso discreto. */
  readonly aoRotacaoParada: (
    ouvinte: (dados: { motivo: string }) => void,
  ) => () => void;

  // ----------------------------------------------------------------- layout
  /** Largura atual do painel da direita, em px (padrão fixo, ver constantes). */
  readonly obterLarguraDoPainel: () => Promise<number>;
  /**
   * Muda a largura do painel (o main reposiciona a BrowserView e guarda no
   * disco). Devolve a largura efetiva, já dentro dos limites.
   */
  readonly definirLarguraDoPainel: (largura: number) => Promise<number>;
  /**
   * Enquanto a divisória está sendo arrastada, a BrowserView é recolhida —
   * senão o mouse cai dentro do TikTok e o painel para de receber o arrasto.
   */
  readonly arrastandoDivisoria: (arrastando: boolean) => Promise<void>;

  /**
   * A audiência da sala em tempo real (viewers, curtidas, presentes), direto
   * do webcast — sem passar pelo backend. É o placar da live no rodapé do
   * cockpit; nenhum destes números carrega identidade de espectador.
   */
  readonly aoReceberAudiencia: (
    ouvinte: (evento: EventoDeAudiencia) => void,
  ) => () => void;

  /** Copia para a área de transferência e avisa `POST /live/replies/:id/copied`. */
  readonly copiarResposta: (replyId: string, texto: string) => Promise<void>;
  /** Copia um rascunho de escalação — não há id de resposta para carimbar. */
  readonly copiarTexto: (texto: string) => Promise<void>;
  /**
   * Guarda a resposta na base de conhecimento, com a correção do vendedor
   * quando houver. É como uma lacuna da base deixa de escalar na próxima live.
   */
  readonly salvarNaBase: (replyId: string, texto?: string) => Promise<void>;
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
