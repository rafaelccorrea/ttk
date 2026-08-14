import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductMetricDaily } from './product-metric-daily.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true, unique: true })
  externalId: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  storeName: string;

  @Index()
  @Column()
  category: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  price: string;

  @Column({ nullable: true })
  imageUrl: string;

  @Column({ type: 'decimal', precision: 3, scale: 1, nullable: true })
  rating: string;

  @Column({ type: 'int', nullable: true })
  radarScore: number;

  @Column({ nullable: true })
  tiktokUrl: string;

  @OneToMany(() => ProductMetricDaily, (m) => m.product)
  metrics: ProductMetricDaily[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
