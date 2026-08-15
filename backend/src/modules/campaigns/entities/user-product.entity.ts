import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Produto do próprio vendedor — não confundir com `products`, que é o catálogo
 * público coletado do TikTok Shop. Aqui é o que ELE vende e quer anunciar.
 *
 * Pode nascer vazio (digitado à mão) ou copiado de um item do catálogo, caso
 * em que `sourceProductId` guarda a origem para efeito de referência.
 */
@Entity('user_products')
export class UserProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_user_products_userId')
  @Column('uuid')
  userId: string;

  @Column()
  name: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  priceBrl: number | null;

  /** O ganho principal, em uma frase — é o que vira a promessa do gancho. */
  @Column({ type: 'text', nullable: true })
  benefit: string | null;

  /** A dor que o produto resolve — é o que vira o problema no gancho. */
  @Column({ type: 'text', nullable: true })
  problemSolved: string | null;

  /** Fotos do vendedor, já espelhadas no S3. Viram B-roll das cenas. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  images: string[];

  /** Id no catálogo público, quando importado de lá. */
  @Column({ type: 'uuid', nullable: true })
  sourceProductId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
