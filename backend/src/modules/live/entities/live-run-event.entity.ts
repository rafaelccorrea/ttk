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
 * O que o app fez (ou viu) DURANTE a transmissão, além do chat:
 *
 *  - `aviso_tiktok`: o detector viu um banner de aviso/restrição na tela do
 *    vendedor — `acao` diz o que o app fez a respeito;
 *  - `pin_produto`: uma tentativa de fixar produto na live, com o desfecho.
 */
export type LiveRunEventTipo = 'aviso_tiktok' | 'pin_produto';

/**
 * Trilha de auditoria da run.
 *
 * Tabela própria (e não colunas na run) porque estes eventos podem acontecer
 * várias vezes por transmissão, e porque a pergunta que eles respondem chega
 * DEPOIS: "o app avisou antes de a conta ser restringida?", "quantos pins
 * falharam esta semana?". `detalhe` é texto CURTO já truncado — nunca HTML da
 * página, que tem tabela própria (`live_selector_failures`).
 */
@Entity('live_run_events')
export class LiveRunEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_live_run_events_liveRunId')
  @Column('uuid')
  liveRunId: string;

  /** Declarada só para o banco — ver `LiveRun.knowledgeSession`. */
  @ManyToOne(() => LiveRun, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'liveRunId',
    foreignKeyConstraintName: 'FK_live_run_events_run',
  })
  liveRun?: LiveRun;

  @Index('IDX_live_run_events_userId')
  @Column('uuid')
  userId: string;

  @Column()
  tipo: LiveRunEventTipo;

  /** O que o app fez: `pausado` | `encerrado` | `ok` | `falhou`... */
  @Column({ type: 'varchar', nullable: true })
  acao: string | null;

  @Column({ type: 'text', nullable: true })
  detalhe: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
