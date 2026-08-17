import { createHash, randomBytes } from 'node:crypto';
import { WebcastPushConnection } from 'tiktok-live-connector';

/**
 * A leitura do chat da transmissão.
 *
 * POR QUE WEBCAST E NÃO SCRAPING DO DOM
 * -------------------------------------
 * A tentação óbvia, num app que já carrega o tiktok.com numa BrowserView, é
 * pendurar um MutationObserver na lista do chat e ler o que aparece. Não
 * funciona, e não é questão de caprichar na implementação: a lista do chat do
 * TikTok é VIRTUALIZADA — ela mantém em tela uma janela de poucas dezenas de
 * nós e DESCARTA o que sai por cima. Em live parada isso até engana; em rajada,
 * que é exatamente o momento em que o copiloto vale dinheiro (o vendedor
 * anuncia o preço e chegam 40 mensagens em dois segundos), o React remove os nós
 * antigos no mesmo frame em que insere os novos, e o observer é chamado depois,
 * em lote, com nós que já saíram do documento. As mensagens somem antes de
 * qualquer leitura. Some a isso que classes e estrutura mudam sem aviso e que o
 * texto renderizado já vem com emoji e badge misturados ao conteúdo.
 *
 * O webcast é a MESMA fonte que a página consome: um WebSocket que entrega a
 * mensagem em protobuf, com o id nativo dela, antes de virar DOM. Nada se perde
 * em rajada e nada depende de layout.
 *
 * O `DomChatSource` da fase 2 existe como plano B DEGRADADO — para o caso de o
 * endpoint do webcast fechar — e é por isso que tudo aqui é programado contra a
 * interface `ChatSource`, e não contra a `tiktok-live-connector`. Ele NÃO é
 * implementado agora: entregar uma fonte que perde mensagem em rajada, sem
 * sinalizar a perda, seria pior do que não ter fonte nenhuma.
 */

/** Uma mensagem do chat como ela sai da fonte, ainda com o nome do autor. */
export interface RawChatMessage {
  /**
   * O id nativo da mensagem no webcast.
   *
   * É a peça que torna a reconexão IDEMPOTENTE: ao reconectar, o TikTok reenvia
   * o histórico recente da sala, e sem um id estável o backend responderia de
   * novo às mesmas perguntas — gastando modelo e repetindo resposta no painel.
   * O backend deduplica por `externalMessageId`, então quem manda precisa
   * mandar o id DELE, nunca um gerado aqui.
   */
  msgId: string;
  /** Nome do espectador. NÃO ATRAVESSA a fronteira do processo — ver `mapear`. */
  username: string;
  text: string;
  receivedAt: Date;
}

/**
 * O contrato que o resto do app enxerga. Trocar a fonte (webcast hoje, DOM
 * degradado na fase 2, um mock nos testes) é trocar a implementação disto.
 */
export interface ChatSource {
  connect(roomIdOuUsername: string): Promise<void>;
  on(evt: 'message', cb: (m: RawChatMessage) => void): void;
  on(evt: 'disconnect' | 'error', cb: (e: Error) => void): void;
  disconnect(): void;
}

/** Mensagem já anonimizada, no formato que o backend aceita. */
export interface ChatMessageAnonima {
  externalMessageId: string;
  authorHash: string;
  text: string;
  receivedAt: string;
}

const BACKOFF_INICIAL_MS = 1_000;
const BACKOFF_MAXIMO_MS = 30_000;

/**
 * O que a `tiktok-live-connector` entrega no evento `chat`. A lib publica os
 * tipos como `any`, então o formato fica declarado aqui, no ponto em que ele é
 * lido — assim uma mudança na lib estoura numa linha só.
 */
interface WebcastChatPayload {
  msgId?: string | number;
  uniqueId?: string;
  nickname?: string;
  comment?: string;
}

/**
 * A fonte padrão: o WebSocket do webcast, via `tiktok-live-connector`.
 *
 * A classe é deliberadamente burra em relação ao backend — ela não conhece run,
 * nem token, nem lote. Só entrega mensagem crua e avisa quando cai.
 */
export class WebcastChatSource implements ChatSource {
  private conexao: WebcastPushConnection | null = null;
  private alvo = '';

  private aoReceber: ((m: RawChatMessage) => void) | null = null;
  private aoCair: ((e: Error) => void) | null = null;
  private aoErrar: ((e: Error) => void) | null = null;

  private backoffMs = BACKOFF_INICIAL_MS;
  private timerReconexao: NodeJS.Timeout | null = null;
  /** Desligado no `disconnect()` para que uma queda em curso não reconecte. */
  private ativo = false;

  async connect(roomIdOuUsername: string): Promise<void> {
    this.alvo = roomIdOuUsername.trim().replace(/^@/, '');
    this.ativo = true;
    await this.abrir();
  }

  on(evt: 'message', cb: (m: RawChatMessage) => void): void;
  on(evt: 'disconnect' | 'error', cb: (e: Error) => void): void;
  on(
    evt: 'message' | 'disconnect' | 'error',
    cb: ((m: RawChatMessage) => void) | ((e: Error) => void),
  ): void {
    if (evt === 'message') this.aoReceber = cb as (m: RawChatMessage) => void;
    else if (evt === 'disconnect') this.aoCair = cb as (e: Error) => void;
    else this.aoErrar = cb as (e: Error) => void;
  }

  disconnect(): void {
    this.ativo = false;
    if (this.timerReconexao) {
      clearTimeout(this.timerReconexao);
      this.timerReconexao = null;
    }
    this.conexao?.disconnect();
    this.conexao = null;
  }

  /**
   * Abre a conexão e pendura os ouvintes.
   *
   * `processInitialData` fica LIGADO: o histórico recente que o TikTok manda na
   * entrada é justamente o que cobre o buraco de uma reconexão. Reprocessar
   * mensagem repetida não custa nada porque o `msgId` deduplica no backend —
   * enquanto perder a pergunta que chegou durante a queda custa a venda.
   */
  private async abrir(): Promise<void> {
    const conexao = new WebcastPushConnection(this.alvo, {
      processInitialData: true,
      enableExtendedGiftInfo: false,
      enableWebsocketUpgrade: true,
      // Sem `sessionId` de propósito: ele só serve para POSTAR no chat, e nesta
      // fase o app não escreve nada no TikTok. Não guardar o cookie de sessão
      // do vendedor é a diferença entre ler uma live e poder falar por ele.
    });

    conexao.on('chat', (dados: WebcastChatPayload) => {
      const mensagem = this.normalizar(dados);
      if (mensagem) this.aoReceber?.(mensagem);
    });

    // A lib emite `disconnected` sem motivo e `streamEnd` quando a live acaba —
    // só a primeira merece reconexão; a segunda é o fim normal da transmissão.
    conexao.on('disconnected', () => {
      this.aoCair?.(new Error('Conexão com o chat caiu.'));
      this.agendarReconexao();
    });
    conexao.on('streamEnd', () => {
      this.ativo = false;
      this.aoCair?.(new Error('A transmissão foi encerrada.'));
    });
    conexao.on('error', (erro: unknown) => {
      this.aoErrar?.(this.comoErro(erro));
    });

    this.conexao = conexao;

    try {
      await conexao.connect();
      // Só zera o backoff DEPOIS de conectar de verdade. Zerar na tentativa
      // faria um alvo que aceita a conexão e cai em seguida girar para sempre a
      // 1s de intervalo, martelando o webcast.
      this.backoffMs = BACKOFF_INICIAL_MS;
    } catch (erro) {
      this.aoErrar?.(this.comoErro(erro));
      this.agendarReconexao();
    }
  }

  /**
   * Backoff exponencial de 1s a 30s.
   *
   * O teto existe porque a falha mais comum aqui é temporária e do outro lado
   * (a live ainda não começou, o webcast recusou por rate limit, a internet do
   * vendedor oscilou). Desistir seria deixar o copiloto morto no meio da live;
   * insistir a cada segundo é o que faz o TikTok bloquear o IP.
   */
  private agendarReconexao(): void {
    if (!this.ativo || this.timerReconexao) return;

    const espera = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAXIMO_MS);

    this.timerReconexao = setTimeout(() => {
      this.timerReconexao = null;
      if (!this.ativo) return;
      void this.abrir();
    }, espera);
  }

  private normalizar(dados: WebcastChatPayload): RawChatMessage | null {
    const texto = (dados.comment ?? '').trim();
    const msgId = dados.msgId != null ? String(dados.msgId) : '';
    // Sem id nativo não dá para deduplicar, e sem dedup a reconexão vira
    // resposta repetida; sem texto não há pergunta. Os dois casos são descarte.
    if (!texto || !msgId) return null;

    return {
      msgId,
      username: dados.uniqueId ?? dados.nickname ?? '',
      text: texto,
      receivedAt: new Date(),
    };
  }

  private comoErro(erro: unknown): Error {
    return erro instanceof Error ? erro : new Error(String(erro));
  }
}

/**
 * O anonimizador — a fronteira de LGPD do produto.
 *
 * O NOME DO ESPECTADOR NUNCA SAI DESTE PROCESSO. Quem escreve no chat de uma
 * live é um terceiro que jamais teve contato com o PikPok e não consentiu com
 * nada; guardar o @ dele no nosso banco seria coletar dado pessoal de quem não
 * é nosso usuário, para um uso que não existe. O backend só precisa distinguir
 * autores para deduplicar e contar repetição ("cinco pessoas perguntaram o
 * preço"), e um hash serve para isso tão bem quanto o nome.
 *
 * O `runId` e um `salt` aleatório POR EXECUÇÃO entram no hash de propósito: um
 * sha256 do username sozinho é reversível na prática — o espaço de @s do TikTok
 * é enumerável, então bastaria uma rainbow table para desfazer a anonimização.
 * Com o salt trocando a cada run, o mesmo espectador tem hash diferente em duas
 * lives, e o único correlacionamento possível é o de dentro da run, que é
 * exatamente o que a dedup precisa e nada além disso.
 */
export class AnonimizadorDeAutor {
  private readonly salt = randomBytes(32).toString('hex');

  constructor(private readonly runId: string) {}

  hash(username: string): string {
    return createHash('sha256')
      .update(`${username}${this.runId}${this.salt}`)
      .digest('hex');
  }

  /** Converte a mensagem crua no que sobe para o backend, já sem o nome. */
  mapear(mensagem: RawChatMessage): ChatMessageAnonima {
    return {
      externalMessageId: mensagem.msgId,
      authorHash: this.hash(mensagem.username),
      text: mensagem.text,
      receivedAt: mensagem.receivedAt.toISOString(),
    };
  }
}
