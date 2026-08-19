import type { AudienceEvent } from './tiktok-chat';

/**
 * O agregador de audiência da transmissão.
 *
 * O webcast despeja eventos soltos (uma curtida, um presente, uma leitura de
 * viewers) num ritmo que pode passar de dezenas por segundo em live cheia.
 * Mandar cada um ao backend seria pagar uma request por curtida; guardar tudo e
 * mandar no fim perderia a live que caiu no meio. A janela de 30s é o meio
 * termo: granular o bastante para desenhar o gráfico da live, barata o bastante
 * para não aparecer na conta de ninguém.
 *
 * Os contadores viram DELTAS por janela — é o contrato de `live_run_metrics`
 * no backend, e o que torna a reconexão inofensiva: o histórico que o webcast
 * reenvia engorda no máximo a janela corrente, nunca dobra a live.
 *
 * O que não consegue subir (rede caiu) fica numa fila local com teto; quando a
 * conexão volta, sobe em lote. Perder métrica antiga é aceitável — ela é
 * retrato, não dinheiro.
 */

/** Um instantâneo no formato que `POST /live/runs/:id/metrics` aceita. */
export interface InstantaneoDeMetrica {
  capturedAt: string;
  viewerCount?: number;
  likes: number;
  gifts: number;
  giftDiamonds: number;
  follows: number;
  shares: number;
  joins: number;
}

export const JANELA_METRICA_MS = 30_000;

/** Espelha o `ArrayMaxSize(120)` do DTO: uma hora de janelas guardadas. */
const FILA_MAXIMA = 120;

export class AgregadorDeMetricas {
  private viewerCount: number | null = null;
  private likes = 0;
  private gifts = 0;
  private giftDiamonds = 0;
  private follows = 0;
  private shares = 0;
  private joins = 0;

  private fila: InstantaneoDeMetrica[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Um envio por vez: dois em paralelo entregariam a fila duplicada. */
  private enviando = false;

  constructor(
    private readonly enviar: (
      pontos: InstantaneoDeMetrica[],
    ) => Promise<void>,
  ) {}

  iniciar(): void {
    this.parar();
    this.timer = setInterval(() => {
      void this.fecharJanela();
    }, JANELA_METRICA_MS);
  }

  /** Fecha a janela corrente, tenta subir o que houver e desliga o relógio. */
  async encerrar(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.fecharJanela();
  }

  private parar(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  registrar(evento: AudienceEvent): void {
    switch (evento.kind) {
      case 'viewers':
        this.viewerCount = evento.value;
        break;
      case 'likes':
        this.likes += evento.value;
        break;
      case 'gift':
        this.gifts += evento.count;
        this.giftDiamonds += evento.diamonds;
        break;
      case 'follow':
        this.follows += 1;
        break;
      case 'share':
        this.shares += 1;
        break;
      case 'join':
        this.joins += 1;
        break;
    }
  }

  private async fecharJanela(): Promise<void> {
    const vazia =
      this.viewerCount === null &&
      this.likes === 0 &&
      this.gifts === 0 &&
      this.follows === 0 &&
      this.shares === 0 &&
      this.joins === 0;

    if (!vazia) {
      this.fila.push({
        capturedAt: new Date().toISOString(),
        // A leitura de nível não zera entre janelas: sem evento novo, o último
        // número conhecido continua sendo a melhor resposta para "quantos
        // assistem". O que zera são as ocorrências.
        ...(this.viewerCount !== null
          ? { viewerCount: this.viewerCount }
          : {}),
        likes: this.likes,
        gifts: this.gifts,
        giftDiamonds: this.giftDiamonds,
        follows: this.follows,
        shares: this.shares,
        joins: this.joins,
      });
      this.likes = 0;
      this.gifts = 0;
      this.giftDiamonds = 0;
      this.follows = 0;
      this.shares = 0;
      this.joins = 0;
      // Estourou o teto: cai a métrica mais VELHA. A live continua na frente
      // do vendedor — o retrato recente vale mais que o de uma hora atrás.
      if (this.fila.length > FILA_MAXIMA) this.fila.shift();
    }

    if (!this.fila.length || this.enviando) return;

    this.enviando = true;
    const lote = this.fila;
    this.fila = [];
    try {
      await this.enviar(lote);
    } catch {
      // Rede ruim no meio da live é o normal: devolve à fila e a próxima
      // janela tenta de novo, com o teto protegendo a memória.
      this.fila = [...lote, ...this.fila].slice(-FILA_MAXIMA);
    } finally {
      this.enviando = false;
    }
  }
}
