import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type CutClipStatus = 'pendente' | 'pronto' | 'falhou';

/** Um corte pronto (ou a caminho) de um {@link CutJob}. */
@Entity('cut_clips')
export class CutClip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_cut_clips_job')
  @Column('uuid')
  jobId: string;

  @Index('IDX_cut_clips_user')
  @Column('uuid')
  userId: string;

  /** Posição na fonte (1 = o mais cedo). */
  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'real' })
  startSeconds: number;

  @Column({ type: 'real' })
  endSeconds: number;

  /** Só no modo inteligente: o que a IA escreveu para o post. */
  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  hook: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  /** `ia` = trecho escolhido pela IA; `rapido` = janela do modo rápido. */
  @Column({ length: 10, default: 'rapido' })
  origin: 'ia' | 'rapido';

  /** A legenda foi queimada de fato neste corte (o job pode ter pedido e o libass falhado). */
  @Column({ type: 'boolean', default: false })
  captions: boolean;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ length: 20, default: 'pendente' })
  status: CutClipStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
