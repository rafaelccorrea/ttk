import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LiveRun } from './live-run.entity';

/**
 * Um instantâneo da audiência da transmissão, tirado pelo app desktop.
 *
 * O chat sempre foi capturado; a AUDIÊNCIA não — e sem ela a página do
 * copiloto na web só conseguia contar mensagens. Este registro é o que permite
 * desenhar a live depois que ela acabou: quantas pessoas assistiam em cada
 * momento, quando choveu curtida, quando saiu presente. Cruzado com as
 * perguntas (que já têm `receivedAt`), é o que responde "o pico foi quando eu
 * mostrei qual produto?".
 *
 * Os contadores são DELTAS DA JANELA (o que aconteceu desde o instantâneo
 * anterior), não totais acumulados: o total se reconstrói somando, e o delta
 * sobrevive a reconexão do app sem dupla contagem — um acumulado reenviado do
 * zero após uma queda dobraria tudo. `viewerCount` é a exceção por natureza:
 * é uma leitura de nível, não um evento contável.
 *
 * Nenhum dado de espectador identificável entra aqui — são só números da sala,
 * a mesma fronteira de LGPD do chat (`LiveChatMessage.authorHash`).
 */
@Entity('live_run_metrics')
@Index('IDX_live_run_metrics_run_capturedAt', ['liveRunId', 'capturedAt'])
export class LiveRunMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  liveRunId: string;

  /** Declarada só para o banco (ver `LiveRun.knowledgeSession`). CASCADE como
   * o chat: a série não tem vida fora da run que a produziu. */
  @ManyToOne(() => LiveRun, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'liveRunId',
    foreignKeyConstraintName: 'FK_live_run_metrics_run',
  })
  liveRun?: LiveRun;

  @Index('IDX_live_run_metrics_userId')
  @Column('uuid')
  userId: string;

  /** Quando o app tirou o instantâneo, segundo o relógio dele — o mesmo motivo
   * de `LiveChatMessage.receivedAt`: numa reconexão os pontos chegam em lote. */
  @Column({ type: 'timestamptz' })
  capturedAt: Date;

  /** Quantas pessoas assistiam neste instante. Nulo quando o webcast não
   * entregou a leitura na janela — ausência não é zero. */
  @Column({ type: 'int', nullable: true })
  viewerCount: number | null;

  @Column({ type: 'int', default: 0 })
  likes: number;

  @Column({ type: 'int', default: 0 })
  gifts: number;

  /** Valor dos presentes da janela, em diamantes — a moeda do TikTok. */
  @Column({ type: 'int', default: 0 })
  giftDiamonds: number;

  @Column({ type: 'int', default: 0 })
  follows: number;

  @Column({ type: 'int', default: 0 })
  shares: number;

  /** Entradas na sala durante a janela (evento `member`). */
  @Column({ type: 'int', default: 0 })
  joins: number;

  @CreateDateColumn()
  createdAt: Date;
}
