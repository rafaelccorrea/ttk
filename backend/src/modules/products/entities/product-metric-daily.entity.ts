import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Product } from './product.entity';

// Série temporal própria: uma linha por produto por dia.
@Entity('product_metrics_daily')
@Unique(['productId', 'date'])
export class ProductMetricDaily {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  productId: string;

  @ManyToOne(() => Product, (p) => p.metrics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'int', default: 0 })
  sales: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  revenue: string;
}
