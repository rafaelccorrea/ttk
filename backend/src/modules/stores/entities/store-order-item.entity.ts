import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StoreOrder } from './store-order.entity';

@Entity('store_order_items')
export class StoreOrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  orderId: string;

  @ManyToOne(() => StoreOrder, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: StoreOrder;

  @Index()
  @Column()
  sku: string;

  @Column({ nullable: true })
  title: string | null;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  unitPrice: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  discount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: string;
}
