import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { StoreOrderItem } from './store-order-item.entity';
import { Store } from './store.entity';

@Entity('store_orders')
@Unique('uq_store_order_external', ['storeId', 'externalId'])
export class StoreOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  storeId: string;

  @ManyToOne(() => Store, (s) => s.orders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @Column()
  externalId: string;

  @Index()
  @Column({ type: 'timestamptz' })
  placedAt: Date;

  @Index()
  @Column()
  status: string;

  /** Status normalizado ('pendente' | 'enviado' | 'concluido' | 'cancelado'). */
  @Column()
  stage: string;

  @Column({ type: 'timestamptz', nullable: true })
  shipBy: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  shippedAt: Date | null;

  @Column({ nullable: true })
  shippingProvider: string | null;

  @Column({ nullable: true })
  trackingCode: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  grossAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  shippingFee: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  discount: string;

  @OneToMany(() => StoreOrderItem, (i) => i.order, { cascade: true })
  items: StoreOrderItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
