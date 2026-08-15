import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('creators')
export class Creator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Handle sem o "@" (ex.: "garcia_indica")
  @Column({ unique: true })
  handle: string;

  @Column()
  name: string;

  @Column({ type: 'int', default: 0 })
  followers: number;

  // GMV dos últimos 30 dias
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  gmvPeriod: string;

  // Vendas dos últimos 30 dias
  @Column({ type: 'int', default: 0 })
  salesPeriod: number;

  @Index()
  @Column()
  category: string;

  /**
   * 'tiktok' = coletado do TikTok (handle, seguidores e avatar verdadeiros).
   * 'seed'   = dado de demonstração. Separar evita apresentar como real algo
   *            que não é — os reais vêm primeiro na listagem.
   */
  @Index()
  @Column({ default: 'seed' })
  source: 'tiktok' | 'seed';

  @Column({ nullable: true })
  avatarUrl: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
