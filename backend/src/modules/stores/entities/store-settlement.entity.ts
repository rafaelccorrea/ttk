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

/**
 * Repasse do marketplace por pedido. É daqui que sai a receita líquida real —
 * o painel do TikTok mostra o bruto, e a diferença é o que o seller não vê.
 */
@Entity('store_settlements')
@Unique('uq_store_settlement_order', ['storeId', 'externalOrderId'])
export class StoreSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @Index()
  @Column()
  externalOrderId: string;

  @Column({ type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  grossAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  platformFee: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  commissionFee: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  affiliateFee: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  shippingFee: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  otherFees: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  netAmount: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
