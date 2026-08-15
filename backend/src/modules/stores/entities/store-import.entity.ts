import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ImportIssue, StoreDataset } from '../sources/store-sync-source';
import { Store } from './store.entity';

/** Histórico de cada importação — o usuário precisa saber o que entrou e o que foi pulado. */
@Entity('store_imports')
export class StoreImport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @Column()
  dataset: StoreDataset;

  @Column({ default: 'csv' })
  source: string;

  @Column({ type: 'varchar', nullable: true })
  fileName: string | null;

  @Column({ type: 'int', default: 0 })
  rowsRead: number;

  @Column({ type: 'int', default: 0 })
  created: number;

  @Column({ type: 'int', default: 0 })
  updated: number;

  @Column({ type: 'int', default: 0 })
  skipped: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  issues: ImportIssue[];

  @CreateDateColumn()
  createdAt: Date;
}
