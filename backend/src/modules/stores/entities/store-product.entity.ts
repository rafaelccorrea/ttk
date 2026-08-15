import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Store } from './store.entity';

/** SKU do catálogo da loja. `cost` é preenchido pelo usuário — é o que destrava margem. */
@Entity('store_products')
@Unique('uq_store_product_sku', ['storeId', 'sku'])
export class StoreProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  storeId: string;

  @ManyToOne(() => Store, (s) => s.products, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @Column()
  sku: string;

  @Column({ nullable: true })
  externalId: string | null;

  @Column()
  title: string;

  @Column({ nullable: true })
  category: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  price: string | null;

  /** Custo do produto, informado pelo usuário (o relatório do TikTok não traz). */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  cost: string | null;

  @Column({ type: 'int', nullable: true })
  stock: number | null;

  /** Estoque mínimo para alerta de ruptura. */
  @Column({ type: 'int', nullable: true })
  stockAlert: number | null;

  @Column({ nullable: true })
  status: string | null;

  @Column({ nullable: true })
  imageUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
