import { BrowserWindow, clipboard } from 'electron';
import Store from 'electron-store';
import { ApiClient } from './api-client';
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
  type SessaoDesktop,
} from '../shared/desktop-api';
import type { LiveEvent } from '../shared/live-events';

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
};

interface EsquemaDeConfig {
  configuracoes?: ConfiguracoesCopiloto;
}

const CONEXAO_INICIAL: EstadoConexao = {
  status: 'desconectado',
  runId: null,
  tiktokUsername: null,
  baseTitulo: null,
  motivo: null,
};

export class Copiloto {
  private readonly api = new ApiClient();
  private readonly disco = new Store<EsquemaDeConfig>({ name: 'copiloto' });

  private chat: ChatSource | null = null;
  private anonimizador: AnonimizadorDeAutor | null = null;
  private acumulador: AcumuladorDeLote<ChatMessageAnonima> | null = null;

  private conexao: EstadoConexao = { ...CONEXAO_INICIAL };
  /**
   * Pausa é do CLIENTE de propósito: ela para de MANDAR mensagem, e não para a
   * cobrança. O minuto continua correndo porque a run continua aberta do outro
   * lado — e prometer "pausar sem pagar" enquanto o backend segue cobrando
   * seria a pior mentira possível, já que só aparece na fatura.
   */
  private pausado = false;

  constructor(private readonly janela: () => BrowserWindow | null) {}

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
  }): Promise<EstadoConexao> {
    if (this.conexao.status === 'ativa' || this.conexao.status === 'pausada') {
      throw new Error('Já existe uma transmissão em andamento.');
    }

    this.atualizarConexao({
      ...CONEXAO_INICIAL,
      status: 'conectando',
      tiktokUsername: params.tiktokUsername,
    });

    try {
      const run = await this.api.abrirRun({
        knowledgeSessionId: params.knowledgeSessionId,
        tiktokUsername: params.tiktokUsername,
      });

      this.anonimizador = new AnonimizadorDeAutor(run.id);
      this.acumulador = new AcumuladorDeLote<ChatMessageAnonima>(
        (lote) => this.api.enviarLote(lote),
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
      });
      throw erro;
    }

    return this.conexao;
  }

  private async conectarChat(alvo: string): Promise<void> {
    const chat = new WebcastChatSource();

    chat.on('message', (mensagem) => {
      if (this.pausado || !this.anonimizador || !this.acumulador) return;
      if (this.filtrada(mensagem.text)) return;
      // A anonimização acontece AQUI, antes do acumulador: assim nenhuma
      // estrutura que possa ser enfileirada, logada ou serializada chega a
      // segurar o @ do espectador.
      this.acumulador.adicionar(this.anonimizador.mapear(mensagem));
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

  async encerrar(motivo?: string): Promise<EstadoConexao> {
    // A cauda do lote vai junto: são as últimas perguntas da live, geralmente
    // as de "ainda dá tempo de comprar?".
    this.acumulador?.descarregar();

    await this.api.encerrarRun(motivo).catch(() => undefined);
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
    this.chat?.disconnect();
    this.chat = null;
    this.acumulador?.parar();
    this.acumulador = null;
    this.anonimizador = null;
    this.pausado = false;
    this.api.pararHeartbeat();
    this.api.pararStream();
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
    if (evento.type === 'reply') {
      const { limiarDescarte } = this.lerConfiguracoes();
      if (evento.data.confidence < limiarDescarte) return;
    }

    if (evento.type === 'credits_exhausted') {
      this.atualizarConexao({
        ...this.conexao,
        status: 'sem_saldo',
        motivo: evento.data.motivo,
      });
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
    };

    this.disco.set('configuracoes', saneado);
    // O acumulador em curso pega o novo teto sem ser recriado — recriar no meio
    // da live descartaria o que estivesse pendente nele.
    if (this.acumulador) this.acumulador.maximoPorLote = saneado.tamanhoDoLote;

    return saneado;
  }

  // ----------------------------------------------------------------- apoio
  private atualizarConexao(estado: EstadoConexao): void {
    this.conexao = estado;
    this.publicar('live:conexao', estado);
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
