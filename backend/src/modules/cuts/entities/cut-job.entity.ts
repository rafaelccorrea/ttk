import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { CutFormat, CutMode } from '../cut-planner';

export type CutJobStatus = 'pendente' | 'processando' | 'pronto' | 'falhou';

/**
 * Um pedido de cortes: uma fonte longa, N cortes curtos.
 *
 * Nasce `pendente` na resposta do upload e vira `processando` no pipeline em
 * background; a tela acompanha por polling. Os marcadores `pending*` guardam
 * o que foi cobrado e ainda não virou entrega — é por eles que o cron devolve
 * o crédito quando o processo morre no meio (mesmo desenho do Live Copilot).
 */
@Entity('cut_jobs')
export class CutJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_cut_jobs_user')
  @Column('uuid')
  userId: string;

  @Index('IDX_cut_jobs_status')
  @Column({ length: 20, default: 'pendente' })
  status: CutJobStatus;

  @Column({ length: 20 })
  mode: CutMode;

  @Column({ length: 10, default: '9:16' })
  format: CutFormat;

  /** Quantos cortes o usuário pediu. */
  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'int' })
  minSeconds: number;

  @Column({ type: 'int' })
  maxSeconds: number;

  @Column({ length: 255 })
  sourceName: string;

  /** Duração medida pelo ffmpeg; `null` até o pipeline abrir o arquivo. */
  @Column({ type: 'int', nullable: true })
  sourceDurationSeconds: number | null;

  /** Caminho do upload em disco. Apagado (e zerado) no fim do pipeline. */
  @Column({ type: 'text', nullable: true })
  sourcePath: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Último batimento do pipeline; o cron reabre quem parou de bater. */
  @Column({ type: 'timestamptz', nullable: true })
  processingStartedAt: Date | null;

  /** Cortes cobrados (`cut` ou `cut_ai`) e ainda não entregues. */
  @Column({ type: 'int', default: 0 })
  pendingCutCharges: number;

  /** Blocos de `transcribe` cobrados e ainda não consumidos (só no inteligente). */
  @Column({ type: 'int', default: 0 })
  pendingTranscribeBlocks: number;

  @CreateDateColumn()
  createdAt: Date;
}
