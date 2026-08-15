import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StoreSourceKind } from '../sources/store-sync-source';
import { StoreOrder } from './store-order.entity';
import { StoreProduct } from './store-product.entity';

/**
 * Loja do usuário. Hoje é sempre alimentada por importação de CSV; os campos
 * `externalShopId`/`source` já existem para quando a fonte virar API oficial.
 */
@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column()
  name: string;

  @Column({ default: 'tiktok_shop' })
  marketplace: string;

  @Column({ default: 'csv' })
  source: StoreSourceKind;

  /** ID da loja no marketplace — preenchido quando houver integração por API. */
  @Column({ nullable: true })
  externalShopId: string | null;

  @Column({ default: 'BRL' })
  currency: string;

  /** Ordem de dia/mês nas datas dos relatórios exportados ('dmy' | 'mdy'). */
  @Column({ default: 'dmy' })
  dateOrder: string;

  /** Comissão padrão do marketplace, usada na calculadora de preço. */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  commissionPct: string;

  /** Imposto padrão sobre a venda (%), usado na calculadora de preço. */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxPct: string;

  @OneToMany(() => StoreProduct, (p) => p.store)
  products: StoreProduct[];

  @OneToMany(() => StoreOrder, (o) => o.store)
  orders: StoreOrder[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
