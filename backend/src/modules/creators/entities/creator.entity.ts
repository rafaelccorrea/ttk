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

  /**
   * ID do criador no fornecedor de dados (`user_id` do EchoTik). É a chave de
   * upsert confiável: o nome de exibição muda, o id não. Nulo nos registros
   * antigos e nos de demonstração.
   */
  @Column({ type: 'varchar', nullable: true, unique: true })
  externalId: string | null;

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
   * 'echotik' = fornecedor pago: GMV e vendas por produto são REAIS.
   * 'tiktok'  = coletado do TikTok (handle, seguidores e avatar verdadeiros).
   * 'seed'    = dado de demonstração. Separar evita apresentar como real algo
   *             que não é — os reais vêm primeiro na listagem.
   */
  @Index('IDX_creators_source')
  @Column({ default: 'seed' })
  source: 'echotik' | 'tiktok' | 'seed';

  @Column({ nullable: true })
  avatarUrl: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
