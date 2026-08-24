import { BrowserWindow, clipboard, type WebContents } from 'electron';
import Store from 'electron-store';
import { ApiClient } from './api-client';
import { MODO_SIMULACAO, SimuladorChatSource } from './chat-simulado';
import { EnviadorDeComentarios } from './comment-sender';
import { fixarProduto, RotadorDeProdutos } from './product-pinner';
import { adicionarBloqueado, usuarioEstaBloqueado } from './tiktok-chat';
import { DetectorDeAviso, scriptDeEncerrar } from './warning-detector';
import { AgregadorDeMetricas } from './metricas';
import { AcumuladorDeLote, JANELA_LOTE_MS } from './rate-limiter';
import {
  AnonimizadorDeAutor,
  WebcastChatSource,
  type ChatMessageAnonima,
  type ChatSource,
} from './tiktok-chat';
import {
  LOTE_MAXIMO,
  LOTE_MINIMO,
  type BaseDeConhecimento,
  type CarteiraLive,
  type ConfiguracoesCopiloto,
  type EstadoAtivacao,
  type EstadoConexao,
  type EstadoEnvio,
  type ProdutoDaLive,
  type SessaoDesktop,
  type TermoDeEnvio,
} from '../shared/desktop-api';
import type { LiveEvent, LiveRunMode } from '../shared/live-events';

/**
 * O maestro do copiloto no processo principal.
 *
 * Ele é quem costura as três peças que não se conhecem — a fonte de chat
 * (`tiktok-chat.ts`), o acumulador de lote (`rate-limiter.ts`) e o cliente da
 * API (`api-client.ts`) — e é o ÚNICO dono do estado da transmissão. O painel
 * não guarda nada disso: ele desenha o que chega por IPC. A razão é a
 * reconexão, que acontece aqui embaixo e em silêncio; um estado espelhado no
 * React divergiria na primeira queda de WebSocket e ninguém perceberia.
 *
 * O fluxo, ponta a ponta:
 *
 *   webcast → anonimiza → acumula 800ms → POST /messages → (backend) →
 *   SSE → filtra pelos limiares → IPC → painel
 *
 * E não há caminho de volta: NADA é escrito no TikTok nesta fase.
 */

const CONFIG_PADRAO: ConfiguracoesCopiloto = {
  // O limiar de exibição casa com o corte que o backend já usa para decidir
  // entre responder e escalar; subir daqui é o vendedor pedindo menos ruído.
  limiarResposta: 0.7,
  limiarDescarte: 0.3,
  listaNegra: [],
  tamanhoDoLote: 12,
  // Detectar o aviso é proteção sem custo; ENCERRAR por causa dele é drástico
  // e começa desligado — ver o comentário no tipo (`desktop-api.ts`).
  detectorAvisoAtivo: true,
  encerrarAoDetectarAviso: false,
  usuariosBloqueados: [],
  // Rotação começa desligada: fixar produto mexe na vitrine do vendedor, e
  // vitrine girando sozinha sem ele ter pedido é surpresa, não feature.
  rotacaoDeProdutosAtiva: false,
  rotacaoIntervaloMinutos: 10,
};

interface EsquemaDeConfig {
  configuracoes?: ConfiguracoesCopiloto;
}

/**
 * O envio começa DESLIGADO em toda abertura de app, e isso não é esquecimento
 * de persistência: "o app lembrou que estava no automático" é o caminho para o
 * copiloto começar a postar sozinho numa live que o vendedor abriu só para
 * testar. Ligar o automático é um gesto consciente por transmissão.
 */
const ENVIO_INICIAL: EstadoEnvio = {
  modo: 'painel',
  aceito: false,
  pausado: false,
  cadenciaSegundos: 8,
  maxPorMinuto: 6,
  degradacao: null,
};

/**
 * De quanto em quanto tempo a fila do backend é consultada.
 *
 * É POLL, e não evento: a fila é unidade de trabalho, e o gargalo é o app
 * digitando letra por letra. Três segundos ficam abaixo do menor cooldown de
 * envio (oito segundos), então nenhuma resposta espera por causa do intervalo —
 * e não são chamadas demais para uma live de uma hora.
 */
const INTERVALO_FILA_MS = 3_000;

const CONEXAO_INICIAL: EstadoConexao = {
  status: 'desconectado',
  runId: null,
  tiktokUsername: null,
  baseTitulo: null,
  motivo: null,
  simulada: false,
};

export class Copiloto {
  private readonly api = new ApiClient();
  private readonly disco = new Store<EsquemaDeConfig>({ name: 'copiloto' });

  private chat: ChatSource | null = null;
  private anonimizador: AnonimizadorDeAutor | null = null;
  private acumulador: AcumuladorDeLote<ChatMessageAnonima> | null = null;
  /**
   * A audiência da sala (viewers, curtidas, presentes), agregada em janelas de
   * 30s e subida ao backend — é o que a página do copiloto na web desenha
   * depois que a live acaba. Nada disso passa pela pausa nem pela lista negra:
   * pausar para de RESPONDER, mas a live continua acontecendo e o retrato dela
   * continua valendo.
   */
  private metricas: AgregadorDeMetricas | null = null;

  private conexao: EstadoConexao = { ...CONEXAO_INICIAL };
  /** A base da run em curso — é dela que a simulação tira o roteiro. */
  private baseConectadaId: string | null = null;
  /**
   * Pausa é do CLIENTE de propósito: ela para de MANDAR mensagem, e não para a
   * cobrança. O minuto continua correndo porque a run continua aberta do outro
   * lado — e prometer "pausar sem pagar" enquanto o backend segue cobrando
   * seria a pior mentira possível, já que só aparece na fatura.
   */
  private pausado = false;
  private envio: EstadoEnvio = { ...ENVIO_INICIAL };

  /**
   * Quem digita no chat do TikTok. Existe sempre, e age só em modo `auto`.
   *
   * Os freios (cooldown, teto por minuto, deduplicação, conferência de entrega,
   * kill switch) vivem todos dentro dele; daqui sai apenas o pedido, e o laço
   * abaixo respeita o `bloqueada` que ele devolve em vez de insistir.
   */
  private readonly enviador: EnviadorDeComentarios;

  /** Varre a live à procura do banner de aviso do TikTok — ver F1 no plano. */
  private detectorDeAviso: DetectorDeAviso | null = null;
  /** Gira a vitrine: fixa o próximo produto da base a cada intervalo. */
  private rotador: RotadorDeProdutos | null = null;

  private timerFila: NodeJS.Timeout | null = null;
  /** Um ciclo de fila por vez: dois em paralelo furariam o cooldown. */
  private rodandoFila = false;

  constructor(
    private readonly janela: () => BrowserWindow | null,
    /**
     * O `webContents` da BrowserView do TikTok. É FUNÇÃO porque a view morre e
     * renasce com a janela — uma referência guardada viraria objeto destruído no
     * meio da live.
     */
    private readonly viewDoTikTok: () => WebContents | null = () => null,
    /**
     * Observador do estado da conexão fora do painel (o modo foco da view).
     * Recebe o mesmo estado que o IPC publica, no mesmo instante.
     */
    private readonly aoMudarConexao: (estado: EstadoConexao) => void = () => {},
    /**
     * A transmissão do @ está no ar? `true`/`false` quando deu para ler a
     * página da live; `null` quando não deu — e o `null` NUNCA bloqueia, porque
     * a leitura é de dado de terceiro sem contrato e negar a live de quem está
     * transmitindo por causa de um HTML remontado seria o erro mais caro.
     */
    private readonly estaAoVivo: (usuario: string) => Promise<boolean | null> = () =>
      Promise.resolve(null),
    /**
     * O palco da simulação: recebe cada pergunta fictícia e cada resposta da
     * IA para o chat da esquerda desenhar. Só é chamado em MODO_SIMULACAO —
     * numa live real o nome do espectador NUNCA sai por aqui.
     */
    private readonly aoAtividadeSimulada: (item: {
      autor: string;
      texto: string;
      ia: boolean;
    }) => void = () => {},
  ) {
    this.enviador = new EnviadorDeComentarios({
      webContents: () => this.viewDoTikTok(),
      buscarConfig: () => this.api.obterConfigDeEnvio(),
      confirmarEntrega: (replyId, status, motivo) =>
        this.api.confirmarEntrega(replyId, status, motivo),
      reportarFalhaDeSeletor: (html, versao) =>
        this.api.reportarFalhaDeSeletor(html, versao),
      aoCairParaPainel: (motivo) => this.degradarParaPainel(motivo),
    });
  }

  // -------------------------------------------------------------- ativação
  iniciarAtivacao(): Promise<EstadoAtivacao> {
    return this.api.iniciarAtivacao((estado) =>
      this.publicar('ativacao:estado', estado),
    );
  }

  obterSessao(): Promise<SessaoDesktop | null> {
    return this.api.obterSessao();
  }

  async sair(): Promise<void> {
    // Encerra antes de esquecer o token: sem ele a chamada de encerramento
    // falharia, e a run ficaria aberta no backend cobrando heartbeat de um app
    // que já saiu. (O heartbeat para junto, mas o status da run não.)
    await this.encerrar('O vendedor saiu da conta.').catch(() => undefined);
    this.api.desconectar();
  }

  listarBases(): Promise<BaseDeConhecimento[]> {
    return this.api.listarBases();
  }

  obterCarteiraLive(): Promise<CarteiraLive> {
    return this.api.obterCarteiraLive();
  }

  /** Os produtos da base conectada — vazio quando não há run em curso. */
  async listarProdutosDaLive(): Promise<ProdutoDaLive[]> {
    if (!this.baseConectadaId) return [];
    return this.api.listarProdutosDaBase(this.baseConectadaId);
  }

  // --------------------------------------------------------------- conexão
  obterConexao(): EstadoConexao {
    return this.conexao;
  }

  /**
   * Abre a run e sobe o chat, nesta ordem.
   *
   * A run PRIMEIRO porque é ela que valida plano, base e saldo — e porque o
   * `runId` é o que salga o hash do autor. Conectar o webcast antes seria
   * receber mensagem sem ter para onde mandá-la e sem poder anonimizá-la.
   */
  async conectar(params: {
    knowledgeSessionId: string;
    tiktokUsername: string;
    simulada?: boolean;
  }): Promise<EstadoConexao> {
    if (this.conexao.status === 'ativa' || this.conexao.status === 'pausada') {
      throw new Error('Já existe uma transmissão em andamento.');
    }

    /*
     * Simulada por PEDIDO ("testar sem estar em live", no painel) ou por
     * AMBIENTE (dev). A escolha vale para a run inteira e viaja no estado da
     * conexão — é como o modo foco sabe desenhar o chat fake e como o rótulo
     * de teste chega à tela.
     */
    const simulada = MODO_SIMULACAO || params.simulada === true;

    /*
     * A conferência vem ANTES de a run existir porque a run COBRA: conectar
     * fora do ar abria uma transmissão de ninguém e os minutos do vendedor
     * escorriam num chat que não existe. Só o `false` explícito barra — ver o
     * contrato de `estaAoVivo` no construtor.
     */
    const aoVivo = simulada
      ? true
      : await this.estaAoVivo(params.tiktokUsername).catch(() => null);
    if (aoVivo === false) {
      throw new Error(
        'Sua live ainda não está no ar. Comece a transmissão no TikTok primeiro e conecte de novo — nenhum minuto foi gasto.',
      );
    }

    this.baseConectadaId = params.knowledgeSessionId;
    this.atualizarConexao({
      ...CONEXAO_INICIAL,
      status: 'conectando',
      tiktokUsername: params.tiktokUsername,
      simulada,
    });

    try {
      const run = await this.api.abrirRun({
        knowledgeSessionId: params.knowledgeSessionId,
        tiktokUsername: params.tiktokUsername,
      });

      this.anonimizador = new AnonimizadorDeAutor(run.id);
      this.metricas = new AgregadorDeMetricas((pontos) =>
        this.api.enviarMetricas(pontos),
      );
      this.metricas.iniciar();

      /*
       * O detector de aviso nasce com a run e morre no `limpar`. Não roda na
       * simulação — lá a "página" é nossa — e respeita o desliga do vendedor.
       * A cascata vem do backend, como todo seletor: quando o TikTok mudar o
       * banner, o conserto é deploy nosso, não release do app.
       */
      if (!simulada && this.lerConfiguracoes().detectorAvisoAtivo) {
        const configEnvio = await this.api
          .obterConfigDeEnvio()
          .catch(() => null);
        const seletoresAviso = configEnvio?.seletores.aviso ?? [];
        if (seletoresAviso.length) {
          const seletoresEncerrar = configEnvio?.seletores.botaoEncerrar ?? [];
          this.detectorDeAviso = new DetectorDeAviso({
            webContents: () => this.viewDoTikTok(),
            seletores: () => seletoresAviso,
            aoDetectar: (aviso) => {
              void this.reagirAoAviso(aviso, seletoresEncerrar);
            },
          });
          this.detectorDeAviso.iniciar();
        }
      }

      /*
       * O rotador nasce em TODA run — inclusive na simulada, onde o pin falha
       * sem estrago (é best-effort) e é exatamente isso que o QA precisa ver:
       * o giro, a auditoria e a pausa após três falhas. O interruptor é lido a
       * cada batida (`ativa`): ligar a rotação no meio da live vale na hora,
       * sem reconectar. Desligado, ele é um timer de 30s que não faz nada.
       */
      {
        this.rotador = new RotadorDeProdutos({
          ativa: () => this.lerConfiguracoes().rotacaoDeProdutosAtiva,
          intervaloMs: () =>
            this.lerConfiguracoes().rotacaoIntervaloMinutos * 60_000,
          titulos: () =>
            this.listarProdutosDaLive().then((ps) => ps.map((p) => p.title)),
          fixar: (titulo) => this.fixarProduto(titulo),
          aoParar: (motivo) => {
            // Canal próprio e DISCRETO: rotação que parou é aviso de rodapé,
            // não a faixa vermelha de aviso do TikTok — confundir os dois
            // ensinaria o vendedor a ignorar a faixa que importa.
            this.publicar('live:rotacao-parada', { motivo });
          },
        });
        this.rotador.iniciar();
      }
      this.acumulador = new AcumuladorDeLote<ChatMessageAnonima>(
        async (lote) => {
          /*
           * O acumulador descarta erro de entrega por decisão (repetir chat de
           * live é responder pergunta velha) — mas descartar SEM CONTAR virou
           * um painel mudo sem pista nenhuma: lote falhando em silêncio tem o
           * mesmo sintoma de live parada. O erro vira o `motivo` da tela, e a
           * mensagem em si continua perdida, como antes.
           */
          try {
            await this.api.enviarLote(lote);
            if (this.conexao.simulada) {
              console.log(`[sim] lote de ${lote.length} mensagem(ns) aceito pelo backend`);
            }
          } catch (erro) {
            console.warn(`[chat] lote de ${lote.length} falhou: ${(erro as Error).message}`);
            this.avisarErro((erro as Error).message);
          }
        },
        JANELA_LOTE_MS,
        this.lerConfiguracoes().tamanhoDoLote,
      );

      this.api.iniciarStream(
        (evento) => this.repassarEvento(evento),
        (erro) => this.avisarErro(erro.message),
      );
      this.api.iniciarHeartbeat((erro) => {
        // Heartbeat que falha é, quase sempre, saldo acabado — e o backend já
        // manda `credits_exhausted` pelo SSE. Aqui só se marca a tela, para o
        // caso de o próprio fluxo ter caído junto.
        this.avisarErro(erro.message);
      });

      await this.conectarChat(params.tiktokUsername);

      this.atualizarConexao({
        ...this.conexao,
        status: 'ativa',
        runId: run.id,
        motivo: null,
      });
    } catch (erro) {
      const mensagem = (erro as Error).message;
      await this.limpar();
      this.atualizarConexao({
        ...CONEXAO_INICIAL,
        status: 'erro',
        tiktokUsername: params.tiktokUsername,
        motivo: mensagem,
        simulada,
      });
      throw erro;
    }

    return this.conexao;
  }

  /**
   * A mensagem foi escrita pela conta que estamos operando?
   *
   * Comparação tolerante de propósito: o alvo pode vir como `@loja`, `loja` ou
   * com a caixa trocada, e o webcast devolve o `uniqueId` cru. Exigir igualdade
   * literal faria o eco nunca casar e toda entrega legítima seria reportada como
   * falha — o erro oposto, e igualmente ruim.
   */
  private mesmoAutor(autor: string, alvo: string): boolean {
    const limpar = (v: string) =>
      (v ?? '').trim().toLowerCase().replace(/^@/, '');
    const a = limpar(autor);
    return a.length > 0 && a === limpar(alvo);
  }

  private async conectarChat(alvo: string): Promise<void> {
    // Em simulação a única peça trocada é a fonte: o lote, o backend, o modelo
    // e o painel continuam os de verdade — é o que faz a simulação valer algo.
    const chat: ChatSource = this.conexao.simulada
      ? // Os produtos da base conectada viram o roteiro: a demo pergunta pelo
        // que existe, e o preço real da base aparece no chat.
        new SimuladorChatSource(
          this.baseConectadaId
            ? await this.api.nomesDeProdutos(this.baseConectadaId)
            : [],
        )
      : new WebcastChatSource();

    chat.on('message', (mensagem) => {
      /*
       * O eco é espelhado ANTES de qualquer filtro, e mesmo com o copiloto
       * pausado: a única prova de que o comentário do app saiu é ele reaparecer
       * no mesmo fluxo que todo mundo vê, e uma mensagem descartada pela lista
       * negra ainda serve como essa prova.
       *
       * Só o TEXTO atravessa — nada de autor. A comparação de quem escreveu
       * acontece AQUI, onde o @ do vendedor já é conhecido, e desce como
       * booleano: sem ela, um espectador repetindo a nossa frase (e o público
       * repete preço no chat toda hora) confirmaria uma entrega que não houve.
       */
      this.enviador.observarMensagem(
        mensagem.text,
        this.mesmoAutor(mensagem.username, alvo),
      );

      // Antes de qualquer filtro, como num chat de verdade: até o "kkkk" que o
      // limiar vai descartar aparece na tela — descartá-lo é parte do show.
      if (this.conexao.simulada) {
        this.aoAtividadeSimulada({
          autor: mensagem.username,
          texto: mensagem.text,
          ia: false,
        });
      }
      if (this.pausado || !this.anonimizador || !this.acumulador) return;
      // O bloqueio por @ vem ANTES do anonimizador, no único ponto autorizado
      // a olhar o username: mensagem de bloqueado não vira hash, lote nem
      // custo. A lista é local (electron-store) e nunca sobe ao backend.
      if (
        usuarioEstaBloqueado(
          mensagem.username,
          this.lerConfiguracoes().usuariosBloqueados,
        )
      ) {
        return;
      }
      if (this.filtrada(mensagem.text)) return;
      // A anonimização acontece AQUI, antes do acumulador: assim nenhuma
      // estrutura que possa ser enfileirada, logada ou serializada chega a
      // segurar o @ do espectador.
      this.acumulador.adicionar(this.anonimizador.mapear(mensagem));
    });

    chat.on('audience', (evento) => {
      this.metricas?.registrar(evento);
      // O placar da live no rodapé do cockpit — direto do webcast, sem volta
      // pelo backend. São números da sala; nenhum carrega espectador.
      this.publicar('live:audiencia', evento);
    });

    // Queda do webcast não derruba a run: a `WebcastChatSource` reconecta
    // sozinha com backoff, e o vendedor só precisa saber que o chat oscilou.
    chat.on('disconnect', (erro) => this.avisarErro(erro.message));
    chat.on('error', (erro) => this.avisarErro(erro.message));

    await chat.connect(alvo);
    this.chat = chat;
  }

  /**
   * A lista negra do vendedor, aplicada ANTES de a mensagem virar lote.
   *
   * Filtrar aqui e não no backend é o que faz a palavra bloqueada não custar
   * nada: a mensagem nem vira request, quanto mais chamada de modelo. É o
   * lugar certo para "promoção", "compra seguidores" e o apelido do
   * concorrente.
   */
  private filtrada(texto: string): boolean {
    const alvo = texto.toLowerCase();
    return this.lerConfiguracoes().listaNegra.some(
      (termo) => termo.trim() !== '' && alvo.includes(termo.toLowerCase()),
    );
  }

  async pausar(pausado: boolean): Promise<EstadoConexao> {
    this.pausado = pausado;
    if (pausado) {
      // O que já estava acumulado vai embora: retomar despejando perguntas de
      // minutos atrás faria o painel responder a uma conversa que já passou.
      this.acumulador?.parar();
    }
    this.atualizarConexao({
      ...this.conexao,
      status: pausado ? 'pausada' : 'ativa',
    });
    return this.conexao;
  }

  async encerrar(
    motivo?: string,
    /*
     * Todo encerramento que NASCE no desktop é deliberado — botão do painel,
     * fechar o app, sair da conta — então `manual` é o padrão. Sem isso, o
     * motivo em texto fazia o backend classificar o fim normal como `erro`,
     * e o histórico contava desistência como falha.
     */
    fim: 'manual' | 'aviso_tiktok' = 'manual',
  ): Promise<EstadoConexao> {
    // A cauda do lote vai junto: são as últimas perguntas da live, geralmente
    // as de "ainda dá tempo de comprar?".
    this.acumulador?.descarregar();
    // A última janela de audiência sobe ANTES de a run fechar — depois do
    // `encerrarRun` o cliente já não tem runId e o envio viraria no-op.
    await this.metricas?.encerrar().catch(() => undefined);
    this.metricas = null;

    await this.api.encerrarRun(motivo, fim).catch(() => undefined);
    await this.limpar();

    this.atualizarConexao({
      ...this.conexao,
      status: 'encerrada',
      runId: null,
      motivo: motivo ?? null,
    });
    return this.conexao;
  }

  private async limpar(): Promise<void> {
    // O envio para PRIMEIRO: a run está acabando, e postar um comentário depois
    // do fim da transmissão é o pior desfecho possível desta fase.
    this.pararFila();
    this.detectorDeAviso?.parar();
    this.detectorDeAviso = null;
    this.rotador?.parar();
    this.rotador = null;
    this.chat?.disconnect();
    this.chat = null;
    this.acumulador?.parar();
    this.acumulador = null;
    // No fim normal o `encerrar` já descarregou; aqui é a rede de segurança
    // dos caminhos de erro, onde só importa parar o relógio.
    await this.metricas?.encerrar().catch(() => undefined);
    this.metricas = null;
    this.anonimizador = null;
    this.pausado = false;
    // A run acabou: o automático não atravessa para a próxima. A `degradacao`
    // fica de pé até o vendedor ligar o modo de novo, porque ela é o registro
    // do que deu errado nesta live e ele ainda precisa lê-lo.
    this.atualizarEnvio({ modo: 'painel', pausado: false });
    this.api.pararHeartbeat();
    this.api.pararStream();
  }

  // ------------------------------------------------------- envio automático
  obterEstadoEnvio(): EstadoEnvio {
    return this.envio;
  }

  async obterTermoDeEnvio(): Promise<TermoDeEnvio> {
    const termo = await this.api.obterTermoDeEnvio();
    // O aceite do servidor manda: se a pessoa aceitou pela web, ou se a versão
    // do termo mudou e o aceite antigo deixou de valer, quem sabe é ele.
    this.atualizarEnvio({ aceito: termo.aceito });
    return termo;
  }

  async aceitarTermoDeEnvio(versao: string): Promise<EstadoEnvio> {
    await this.api.aceitarEnvioAutomatico(versao);
    this.atualizarEnvio({ aceito: true });
    return this.envio;
  }

  /**
   * Liga ou desliga o automático.
   *
   * Quem decide é o backend: ele confere aceite, plano e kill switch, e a
   * recusa dele sobe como rejeição até a tela. O estado local só muda DEPOIS do
   * 200 — otimizar isso deixaria a chave em "automático" enquanto o servidor
   * segue com a run em `painel`, que é exatamente a mentira que esta fase não
   * pode contar.
   */
  async definirModoDeEnvio(modo: LiveRunMode): Promise<EstadoEnvio> {
    const resposta = await this.api.trocarModo(modo);

    if (modo === 'auto') {
      // Os limites vão para a tela junto com a troca porque é neste instante
      // que o vendedor precisa ler quanto o copiloto vai falar. Falhar aqui não
      // impede o modo: os valores padrão do enviador continuam valendo.
      const limites = await this.api
        .obterConfigDeEnvio()
        .catch(() => null);
      this.atualizarEnvio({
        modo: resposta.mode,
        degradacao: null,
        ...(limites
          ? {
              cadenciaSegundos: Math.round(limites.limites.cooldownMs / 1000),
              maxPorMinuto: limites.limites.maxPorMinuto,
            }
          : {}),
      });
    } else {
      this.atualizarEnvio({ modo: resposta.mode });
    }

    // O laço da fila é o que faz o modo automático existir de fato: sem ele a
    // run fica 'auto' no servidor, a fila acumula 'pendente' e nada é postado.
    if (resposta.mode === 'auto') this.iniciarFila();
    else this.pararFila();

    return this.envio;
  }

  /* ------------------------------------------------------------ a fila */

  private iniciarFila(): void {
    this.pararFila();
    // A política (cooldown, teto, seletores, kill switch) passa a ser rebuscada
    // de minuto em minuto — é o que faz o kill switch da frota valer em 60s.
    this.enviador.iniciar();
    this.timerFila = setInterval(() => {
      void this.rodarFila();
    }, INTERVALO_FILA_MS);
  }

  private pararFila(): void {
    if (this.timerFila) {
      clearInterval(this.timerFila);
      this.timerFila = null;
    }
    this.enviador.parar();
  }

  /**
   * Um ciclo: pega a fila e tenta postar, uma resposta por vez.
   *
   * TODA condição de parada é reconferida ANTES de cada envio, e não só no
   * começo do ciclo: o vendedor pode apertar a parada de emergência no meio de
   * uma digitação de 140 caracteres, e o que ele espera é que a próxima não
   * saia. Um `bloqueada` (cooldown, teto, mesma pessoa) encerra o ciclo em vez
   * de tentar a seguinte — insistir na sequência é exatamente a rajada que os
   * limites existem para evitar.
   */
  private async rodarFila(): Promise<void> {
    if (this.rodandoFila || !this.podeEnviar()) return;
    this.rodandoFila = true;
    try {
      const fila = await this.api.filaDeEnvio();
      for (const item of fila) {
        if (!this.podeEnviar()) break;
        /*
         * Em simulação não há campo de comentário onde digitar — a esquerda é
         * a NOSSA página. Tentar o enviador real terminava em "não achei o
         * campo", derrubava o automático e ainda reportava falha de seletor ao
         * backend, sujando a telemetria da frota com um erro de mentira. A
         * entrega simulada posta no chat fake e confirma como enviada — o
         * ciclo completo do automático, visível, sem tocar o TikTok.
         */
        // O nome de quem perguntou só existe AQUI, no mapa em memória da run —
        // é o que permite endereçar a resposta sem o @ jamais ter saído do app.
        const nomeDoAutor = this.anonimizador?.nomeDe(item.authorHash) ?? undefined;
        const resultado = this.conexao.simulada
          ? await this.entregarSimulado(item.id, item.text, nomeDoAutor)
          : await this.enviador.enviar({
              replyId: item.id,
              texto: item.text,
              authorHash: item.authorHash,
              nomeDoAutor,
            });
        if (resultado.status !== 'enviada') break;
      }
    } catch {
      // Rede ruim no meio da live é o normal, não a exceção: o próximo ciclo
      // tenta de novo, e a fila do servidor expira sozinha por idade.
    } finally {
      this.rodandoFila = false;
    }
  }

  /**
   * A entrega do modo automático quando a live é simulada: a resposta aparece
   * no chat fake como postada pela loja e o backend a marca como enviada — o
   * mesmo desfecho contábil do envio real, sem DOM nenhum no caminho.
   */
  private async entregarSimulado(
    replyId: string,
    texto: string,
    nomeDoAutor?: string,
  ): Promise<{ status: 'enviada' }> {
    this.aoAtividadeSimulada({
      autor: 'PikPok IA · pela sua conta',
      texto: nomeDoAutor ? `${nomeDoAutor}: ${texto}` : texto,
      ia: true,
    });
    await this.api.confirmarEntrega(replyId, 'enviada').catch(() => undefined);
    return { status: 'enviada' };
  }

  /** As travas locais, todas juntas: run de pé, modo automático, sem pausa. */
  private podeEnviar(): boolean {
    return (
      this.conexao.status === 'ativa' &&
      this.envio.modo === 'auto' &&
      !this.envio.pausado &&
      this.enviador.ativo
    );
  }

  /**
   * A PARADA DE EMERGÊNCIA.
   *
   * Para só o envio, e de propósito: o vendedor aperta isto quando o copiloto
   * escreveu algo estranho no chat, e nesse momento ele não quer perder a
   * transcrição, a fila de escalação nem a run — quer que o app pare de
   * escrever. Encerrar junto obrigaria a reconectar a live para voltar.
   */
  pausarEnvio(pausado: boolean): EstadoEnvio {
    this.atualizarEnvio({ pausado });
    /*
     * O laço para de verdade, e não só na tela. O `podeEnviar` já barraria o
     * próximo envio, mas derrubar o timer é o que garante que nem a consulta da
     * fila continua acontecendo depois do freio de mão.
     */
    if (pausado) this.pararFila();
    else if (this.envio.modo === 'auto' && this.conexao.status === 'ativa') {
      this.iniciarFila();
    }
    return this.envio;
  }

  /**
   * O app caiu sozinho para somente-painel.
   *
   * É a porta por onde o `EnviadorDeComentarios` avisa (seletor quebrado, kill
   * switch da frota). O modo volta para `painel` LOCALMENTE mesmo que a run
   * siga marcada como `auto` no servidor — a verdade que importa para a tela é
   * a do app que digita, e ele parou de digitar.
   */
  degradarParaPainel(motivo: string): void {
    this.atualizarEnvio({ modo: 'painel', degradacao: motivo });
    // Degradar sem derrubar o laço deixaria o app consultando (e tentando) uma
    // fila que ele acabou de declarar que não consegue entregar.
    this.pararFila();
  }

  /**
   * A reação ao banner de aviso do TikTok, na ordem do risco: primeiro o app
   * PARA de escrever (fila parada, envio pausado), depois avisa — a tela do
   * vendedor e a trilha de auditoria — e só ENCERRA a transmissão se o
   * vendedor ligou o opt-in nas configurações. O padrão nunca encerra: um
   * falso positivo que pausa custa cliques; um que derruba a live custa a
   * venda da noite.
   */
  private async reagirAoAviso(
    aviso: { seletorUsado: string; textoResumo: string },
    seletoresEncerrar: string[],
  ): Promise<void> {
    const encerrarTambem = this.lerConfiguracoes().encerrarAoDetectarAviso;
    const acao = encerrarTambem ? 'encerrado' : 'pausado';

    this.pararFila();
    this.atualizarEnvio({ pausado: true });

    this.publicar('live:aviso-tiktok', {
      texto: aviso.textoResumo,
      acao,
    });
    await this.api
      .registrarEventoDaRun('aviso_tiktok', acao, aviso.textoResumo)
      .catch(() => undefined);

    if (!encerrarTambem) return;
    const conteudo = this.viewDoTikTok();
    if (conteudo && !conteudo.isDestroyed() && seletoresEncerrar.length) {
      try {
        await conteudo.executeJavaScript(
          scriptDeEncerrar(seletoresEncerrar),
          true,
        );
      } catch {
        // O encerramento no backend acontece do mesmo jeito, logo abaixo — o
        // clique é cortesia para a transmissão cair junto.
      }
    }
    await this.encerrar(
      'O TikTok emitiu um aviso de restrição.',
      'aviso_tiktok',
    ).catch(() => undefined);
  }

  /**
   * Fixa um produto da base na live — best-effort, ver `product-pinner.ts`.
   * O desfecho (sucesso ou etapa que falhou) vai para a trilha de auditoria.
   */
  async fixarProduto(titulo: string): Promise<{ ok: boolean; motivo?: string }> {
    const config = await this.api.obterConfigDeEnvio().catch(() => null);
    const resultado = await fixarProduto(
      this.viewDoTikTok(),
      config?.seletores.painelProdutos ?? [],
      config?.seletores.botaoPin ?? [],
      titulo,
    );
    await this.api
      .registrarEventoDaRun(
        'pin_produto',
        resultado.ok ? 'ok' : 'falhou',
        resultado.ok ? titulo : `${titulo} — ${resultado.etapaFalhou}`,
      )
      .catch(() => undefined);
    if (resultado.ok) return { ok: true };
    // A mensagem diz ONDE parou: cada etapa pede uma ação diferente do
    // vendedor, e "não consegui clicar" para tudo o mandava caçar um botão que
    // às vezes nem estava na tela.
    const motivos: Record<string, string> = {
      painel_produtos:
        'Não achei o painel de produtos da live. Abra o painel do TikTok Shop na transmissão e tente de novo — ou fixe manualmente.',
      botao_pin:
        'Achei o painel, mas não o botão de fixar. O TikTok pode ter mudado a tela — fixe manualmente que o resto continua funcionando.',
      produto:
        'Não encontrei este produto no painel da live. Confira se ele está na vitrine da transmissão — ou fixe manualmente.',
    };
    return {
      ok: false,
      motivo:
        motivos[resultado.etapaFalhou ?? ''] ??
        'Não consegui fixar. O TikTok pode ter mudado a tela — fixe manualmente que o resto continua funcionando.',
    };
  }

  // --------------------------------------------------------------- eventos
  /**
   * Repassa o evento do SSE ao painel, aplicando os limiares do vendedor.
   *
   * Os cortes ficam no cliente porque são preferência de operação, ajustada no
   * meio da live: o backend já gravou a resposta e já pagou o modelo, então
   * esconder no cliente não desperdiça nada — e ir ao servidor para mudar um
   * limiar seria uma forma a mais de a mudança não valer bem na hora em que ela
   * importa.
   */
  private repassarEvento(evento: LiveEvent): void {
    // Na simulação o terminal é o raio-X: cada evento do SSE aparece, e a
    // ausência deles aponta o lado do fio em que o silêncio nasce.
    if (this.conexao.simulada) console.log(`[sim] SSE: ${evento.type}`);
    if (evento.type === 'reply') {
      const { limiarDescarte } = this.lerConfiguracoes();
      if (evento.data.confidence < limiarDescarte) return;
      /*
       * A resposta NÃO entra no chat simulado aqui: quem a põe lá é a entrega
       * (`entregarSimulado`), como numa live real — o rascunho mora no painel,
       * e o chat só mostra o que foi postado. Publicar nos dois momentos
       * duplicava a mesma frase na tela, uma como "gerada" e outra como
       * "enviada", parecendo eco.
       */
    }

    if (evento.type === 'mode') {
      // A troca pode ter partido de outra janela da mesma conta; acompanhar o
      // servidor evita duas telas discordando sobre quem está postando no chat.
      this.atualizarEnvio({ modo: evento.data.mode });
      // A troca veio de fora, mas o laço é local: sem isto, uma janela que
      // desligasse o automático deixaria ESTE app postando no chat.
      if (
        evento.data.mode === 'auto' &&
        !this.envio.pausado &&
        this.conexao.status === 'ativa'
      ) {
        this.iniciarFila();
      }
      else this.pararFila();
    }

    if (evento.type === 'credits_exhausted') {
      // Sem saldo a run está encerrada do lado do servidor: nada mais sai.
      this.pararFila();
      this.atualizarConexao({
        ...this.conexao,
        status: 'sem_saldo',
        motivo: evento.data.motivo,
      });
    }

    if (evento.type === 'duration_limit_reached') {
      // O servidor encerrou pelo teto de duração do plano; o `ended` chega
      // logo atrás com o estado final — aqui só se garante que nada mais
      // tenta sair para o chat no intervalo.
      this.pararFila();
    }

    if (evento.type === 'ended') {
      void this.limpar();
      this.atualizarConexao({
        ...this.conexao,
        status: 'encerrada',
        runId: null,
        motivo: evento.data.motivo,
      });
    }

    this.publicar('live:evento', evento);
  }

  /**
   * Copiar é o gesto que MEDE esta fase inteira: sem envio automático, a única
   * evidência de que o copiloto acertou é o humano ter escolhido usar o texto.
   * Por isso a área de transferência é preenchida primeiro e o carimbo vai
   * depois, sem bloquear — perder a telemetria é aceitável, deixar o vendedor
   * sem o texto colado no meio da live não é.
   */
  async copiarResposta(replyId: string, texto: string): Promise<void> {
    clipboard.writeText(texto);
    await this.api.marcarCopiada(replyId).catch(() => undefined);
  }

  copiarTexto(texto: string): void {
    clipboard.writeText(texto);
  }

  /**
   * Salva a resposta na base — o gesto que faz a próxima live ser melhor.
   *
   * O erro SOBE, ao contrário do carimbo de cópia. São promessas diferentes:
   * copiar entrega o texto na hora e a telemetria é bônus; salvar na base é uma
   * promessa sobre o futuro, e uma promessa quebrada em silêncio só aparece
   * semanas depois, quando o copiloto escala de novo a pergunta que o vendedor
   * jura ter ensinado.
   */
  async salvarNaBase(replyId: string, texto?: string): Promise<void> {
    await this.api.salvarNaBase(replyId, texto);
  }

  /**
   * O vendedor resolveu a escalação na voz.
   *
   * Não existe rota para isso no backend, e é proposital: o card da escalação
   * vive na tela do painel, e "eu já respondi essa" é estado de UI. Guardar no
   * servidor exigiria uma tabela para um dado que ninguém consulta depois.
   * O método existe para o painel ter um ponto único de saída caso a fase 2
   * queira medir isso.
   */
  resolverEscalacao(
    _chatMessageId: string,
    _desfecho: 'respondida' | 'descartada',
  ): void {
    // Sem efeito no backend por ora — ver o comentário acima.
  }

  /**
   * O "bloquear autor" do card, com um clique.
   *
   * O painel só tem o hash; o @ mora no mapa em memória do anonimizador desta
   * run e é resolvido AQUI, no processo principal — ele entra na lista de
   * bloqueio e nunca atravessa o IPC de volta (nem o log: só o hash aparece).
   * Sem nome é porque a run atual nunca viu esse hash: mensagem de antes da
   * reconexão, de outra live, ou já podada do mapa. O bloqueio é local e
   * reversível em Ajustes, por isso não pede confirmação.
   */
  bloquearAutor(authorHash: string): { ok: boolean; motivo?: string } {
    const nome = authorHash ? this.anonimizador?.nomeDe(authorHash) : null;
    if (!nome) {
      console.info(`[chat] bloqueio pedido para hash desconhecido ${authorHash.slice(0, 12)}…`);
      return {
        ok: false,
        motivo: 'Não achei quem escreveu (a mensagem é antiga ou de outra live).',
      };
    }
    const atuais = this.lerConfiguracoes();
    this.salvarConfiguracoes({
      ...atuais,
      usuariosBloqueados: adicionarBloqueado(atuais.usuariosBloqueados, nome),
    });
    console.info(`[chat] autor bloqueado pelo card (hash ${authorHash.slice(0, 12)}…)`);
    return { ok: true };
  }

  // --------------------------------------------------------- configurações
  lerConfiguracoes(): ConfiguracoesCopiloto {
    return { ...CONFIG_PADRAO, ...this.disco.get('configuracoes') };
  }

  /**
   * O saneamento é aqui, e não na tela: o renderer é conteúdo, e um lote de
   * 5.000 mensagens ou um limiar negativo vindos dele quebrariam o backend ou o
   * acumulador. Toda entrada do painel é tratada como não confiável.
   */
  salvarConfiguracoes(valores: ConfiguracoesCopiloto): ConfiguracoesCopiloto {
    const limitar = (n: number): number => Math.min(1, Math.max(0, Number(n) || 0));

    const saneado: ConfiguracoesCopiloto = {
      limiarResposta: limitar(valores.limiarResposta),
      limiarDescarte: limitar(valores.limiarDescarte),
      listaNegra: (valores.listaNegra ?? [])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 100),
      tamanhoDoLote: Math.min(
        LOTE_MAXIMO,
        Math.max(LOTE_MINIMO, Math.round(Number(valores.tamanhoDoLote) || 0)),
      ),
      detectorAvisoAtivo: valores.detectorAvisoAtivo !== false,
      encerrarAoDetectarAviso: valores.encerrarAoDetectarAviso === true,
      usuariosBloqueados: (valores.usuariosBloqueados ?? [])
        .map((u) => String(u).trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean)
        .slice(0, 200),
      rotacaoDeProdutosAtiva: valores.rotacaoDeProdutosAtiva === true,
      rotacaoIntervaloMinutos: Math.min(
        60,
        Math.max(2, Math.round(Number(valores.rotacaoIntervaloMinutos) || 10)),
      ),
    };

    this.disco.set('configuracoes', saneado);
    // O acumulador em curso pega o novo teto sem ser recriado — recriar no meio
    // da live descartaria o que estivesse pendente nele.
    if (this.acumulador) this.acumulador.maximoPorLote = saneado.tamanhoDoLote;

    return saneado;
  }

  // ----------------------------------------------------------------- apoio
  private atualizarEnvio(mudanca: Partial<EstadoEnvio>): void {
    this.envio = { ...this.envio, ...mudanca };
    this.publicar('envio:estado', this.envio);
  }

  private atualizarConexao(estado: EstadoConexao): void {
    this.conexao = estado;
    this.publicar('live:conexao', estado);
    this.aoMudarConexao(estado);
  }

  private avisarErro(motivo: string): void {
    // Não muda o status: o chat e o SSE reconectam sozinhos, e derrubar a tela
    // para 'erro' a cada oscilação de wi-fi treinaria o vendedor a ignorar o
    // aviso justamente quando ele for real.
    this.atualizarConexao({ ...this.conexao, motivo });
  }

  private publicar(canal: string, dados: unknown): void {
    const janela = this.janela();
    if (janela && !janela.isDestroyed()) {
      janela.webContents.send(canal, dados);
    }
  }
}
