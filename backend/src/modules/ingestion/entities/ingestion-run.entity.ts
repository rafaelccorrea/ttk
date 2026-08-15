import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type IngestionRunStatus = 'running' | 'success' | 'error';
export type IngestionTrigger = 'cron' | 'manual';

// Histórico de execuções do scraper (auditoria e monitoramento).
@Entity('ingestion_runs')
export class IngestionRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  trigger: IngestionTrigger;

  @Column({ type: 'varchar', length: 10, default: 'running' })
  status: IngestionRunStatus;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  hashtagsFetched: number;

  @Column({ type: 'int', default: 0 })
  creatorsFetched: number;

  @Column({ type: 'int', default: 0 })
  videosUpserted: number;

  @Column({ type: 'int', default: 0 })
  productsEnriched: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
