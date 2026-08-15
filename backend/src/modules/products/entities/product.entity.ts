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

  /** Galeria: várias fotos reais do produto (a primeira costuma ser imageUrl). */
  @Column({ type: 'jsonb', nullable: true })
  images: string[] | null;

  @Column({ type: 'decimal', precision: 3, scale: 1, nullable: true })
  rating: string;

  @Column({ type: 'int', nullable: true })
  radarScore: number;

  @Column({ nullable: true })
  tiktokUrl: string;

  // ------------------------------------------------ métricas por período
  // Vêm prontas do fornecedor (acumulados de 7/30/60/90 dias) no mesmo
  // request que atualiza o produto. Existem porque a série diária só tem o
  // dia corrente — sem isso, filtrar por 7 ou 90 dias dava o mesmo resultado.

  @Column({ type: 'int', default: 0 })
  sales7d: number;

  @Index()
  @Column({ type: 'int', default: 0 })
  sales30d: number;

  @Column({ type: 'int', default: 0 })
  sales60d: number;

  @Column({ type: 'int', default: 0 })
  sales90d: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  revenue7d: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  revenue30d: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  revenue60d: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  revenue90d: string;

  /**
   * Assinatura normalizada do título, usada para achar o mesmo produto
   * anunciado por vendedores ou variações diferentes.
   */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  dedupKey: string | null;

  /**
   * Cópia de outro produto já listado. Fica no banco (o histórico de métricas
   * importa) mas sai das listagens, senão a vitrine repete o mesmo item.
   */
  @Index()
  @Column({ type: 'boolean', default: false })
  isDuplicate: boolean;

  // ------------------------------------------------- controle de ingestão
  // A cota do fornecedor é mensal, então o catálogo é revisitado em rodízio.
  // Estas colunas dizem o que já foi feito e quando, para priorizar.

  /** Id do produto na TikTok Shop, sem prefixo — chave para a API do fornecedor. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  tiktokProductId: string | null;

  /** Última atualização de métricas (barata: 10 produtos por request). */
  @Column({ type: 'timestamptz', nullable: true })
  lastRefreshedAt: Date | null;

  /** Última busca de vídeos e criadores (cara: ~4 requests por produto). */
  @Column({ type: 'timestamptz', nullable: true })
  lastEnrichedAt: Date | null;

  /** Histórico diário já preenchido via `product/trend` (uma vez por produto). */
  @Column({ type: 'boolean', default: false })
  historyBackfilled: boolean;

  @OneToMany(() => ProductMetricDaily, (m) => m.product)
  metrics: ProductMetricDaily[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
