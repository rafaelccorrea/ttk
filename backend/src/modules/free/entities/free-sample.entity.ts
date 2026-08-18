import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * O conjunto de itens que toda conta gratuita enxerga numa janela de 7 dias.
 *
 * Ver `docs/CONTA-FREE.md` para o porquê do desenho e
 * `1786668800000-AddFreeSamples.ts` para o porquê de cada coluna.
 */
@Entity('free_samples')
export class FreeSample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Número da janela de 7 dias desde a época Unix. UNIQUE: uma janela, uma
   * amostra — é o que impede duas requisições simultâneas de gerarem dois
   * snapshots diferentes para a mesma semana.
   */
  @Index('IDX_free_samples_slot', { unique: true })
  @Column('int')
  slot: number;

  /** Quando esta amostra deixa de valer. É quem manda na rotação, não o cron. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Ids congelados, na ordem em que a tela deve exibi-los. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  productIds: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  videoIds: string[];

  /** Criadores da janela: a cauda do ranking, nunca o topo. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  creatorIds: string[];

  @CreateDateColumn()
  createdAt: Date;
}
