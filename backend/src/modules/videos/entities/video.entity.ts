import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true, unique: true })
  externalId: string;

  @Column('text')
  caption: string;

  @Column()
  creatorHandle: string;

  @Column({ type: 'int', default: 0 })
  views: number;

  @Column({ type: 'int', default: 0 })
  likes: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  revenueEstimate: string;

  @Column({ type: 'date' })
  postedAt: string;

  // URL pública do vídeo no TikTok (usada para embed no frontend).
  @Column({ nullable: true })
  videoUrl: string;

  @Column({ type: 'text', nullable: true })
  transcript: string | null;

  @Column({ type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'productId' })
  product: Product | null;

  @Index()
  @Column()
  category: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
