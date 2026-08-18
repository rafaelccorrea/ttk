/**
 * O acumulador de lote entre o chat e o backend.
 *
 * POR QUE ACUMULAR EM VEZ DE MANDAR MENSAGEM A MENSAGEM
 * ----------------------------------------------------
 * O chat de uma live não chega em ritmo constante: fica quieto por meio minuto
 * e despeja 40 mensagens quando o vendedor fala o preço. Mandando uma request
 * por mensagem, a rajada vira 40 requests simultâneas, 40 chamadas de modelo e
 * 40 respostas caindo no painel de uma vez — caro, lento e ilegível. Juntando
 * numa janela curta, o backend recebe o bloco inteiro, deduplica ("cinco
 * pessoas perguntaram o frete" vira UMA resposta) e o painel mostra uma fila
 * que dá para ler.
 *
 * A janela é de 800ms porque é o maior atraso que ainda passa despercebido numa
 * conversa falada: o vendedor lê a resposta e responde em voz alta alguns
 * segundos depois da pergunta de qualquer jeito. Menos que isso não agrupa
 * rajada nenhuma; mais que isso o copiloto começa a responder pergunta que já
 * passou.
 *
 * FASE 2 — O QUE ESTA CLASSE VAI VIRAR
 * ------------------------------------
 * Hoje ela só agrupa, porque nesta fase NADA é enviado ao TikTok: o teto de
 * ritmo que importa é o do nosso próprio backend, e o lote já dá conta. Quando
 * o envio automático entrar, o mesmo ponto do fluxo passa a precisar de dois
 * limites do lado da SAÍDA, e é por isso que eles já estão declarados abaixo em
 * vez de virarem números soltos depois:
 *
 *  - COOLDOWN_ENVIO_MS (8s) entre duas mensagens postadas no chat. É o intervalo
 *    que faz o bot parecer gente digitando; abaixo disso o TikTok trata como
 *    spam e silencia a conta do vendedor — o pior desfecho possível, porque o
 *    prejuízo é dele, na conta dele, no meio da live dele;
 *  - TETO_ENVIOS_POR_MINUTO (6) como trava dura por cima do cooldown, para o
 *    caso de o cooldown ser burlado por um caminho que ninguém previu (retry,
 *    reconexão, duas runs abertas por engano). Um teto que conta janela é a
 *    única defesa que sobrevive a bug de fluxo.
 *
 * A estrutura já está preparada: `entregar` é o ponto único de saída, então a
 * fila de envio da fase 2 encaixa aqui sem tocar em quem chama.
 */

/** Janela de agrupamento do lote de entrada. */
export const JANELA_LOTE_MS = 800;

/** Fase 2: intervalo mínimo entre duas mensagens POSTADAS no chat. */
export const COOLDOWN_ENVIO_MS = 8_000;

/** Fase 2: teto duro de mensagens postadas por minuto. */
export const TETO_ENVIOS_POR_MINUTO = 6;

/**
 * O backend recusa lote acima de 200 itens (`LoteDeChatDto`, `ArrayMaxSize`).
 * Cortar aqui, com folga, evita que uma rajada absurda derrube o lote INTEIRO
 * num 400 — perder o excedente é ruim, perder tudo é pior.
 */
const MAXIMO_POR_LOTE = 150;

export class AcumuladorDeLote<T> {
  private pendentes: T[] = [];
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param entregar Chamado com o bloco fechado. Se ele rejeitar, o lote é
   *   PERDIDO por decisão: repetir chat de live é responder pergunta velha, e
   *   a mensagem que importa quase sempre volta pelo próprio chat.
   */
  constructor(
    private readonly entregar: (lote: T[]) => void | Promise<void>,
    private readonly janelaMs: number = JANELA_LOTE_MS,
    /**
     * Teto de itens que fecha o lote antes da janela. O vendedor ajusta isso na
     * tela de configurações — é o botão de "responder mais rápido em live
     * parada" versus "agrupar mais em live cheia" —, e por isso é mutável: a
     * mudança precisa valer no meio da transmissão, sem recriar o acumulador.
     */
    public maximoPorLote: number = MAXIMO_POR_LOTE,
  ) {}

  adicionar(item: T): void {
    this.pendentes.push(item);

    // A rajada que estoura o teto fecha o lote na hora, sem esperar a janela:
    // segurar o excedente só aumentaria o atraso do que já está grande.
    if (this.pendentes.length >= Math.min(this.maximoPorLote, MAXIMO_POR_LOTE)) {
      this.descarregar();
      return;
    }

    // O timer é armado UMA vez por janela, e não reiniciado a cada mensagem.
    // Reiniciar (debounce) seria fatal aqui: num chat que nunca fica 800ms em
    // silêncio, o lote jamais fecharia e o copiloto ficaria mudo justamente na
    // live movimentada.
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.descarregar();
      }, this.janelaMs);
    }
  }

  /** Fecha o lote agora — usado no encerramento da run, para não perder a cauda. */
  descarregar(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendentes.length === 0) return;

    const lote = this.pendentes;
    this.pendentes = [];
    void Promise.resolve(this.entregar(lote)).catch(() => undefined);
  }

  /** Descarta o que estiver pendente e desarma o timer. */
  parar(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendentes = [];
  }
}
