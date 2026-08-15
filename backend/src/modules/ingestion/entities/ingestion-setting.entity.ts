import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Configuração única (linha id=1) do agendamento do scraper.
@Entity('ingestion_settings')
export class IngestionSetting {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  // Expressão cron de 6 campos (seg min hora dia mês dia-semana).
  @Column({ default: '0 0 6 * * *' })
  cronExpr: string;

  @Column({ default: true })
  enabled: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
