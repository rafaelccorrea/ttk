import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Configuração única (linha id=1) do agendamento do scraper.
@Entity('ingestion_settings')
export class IngestionSetting {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  // Expressão cron de 6 campos (seg min hora dia mês dia-semana).
  // Padrão: 3x ao dia (06:00, 14:00 e 22:00). A API paga é consumida só aqui,
  // nunca em request de usuário.
  @Column({ default: '0 0 6,14,22 * * *' })
  cronExpr: string;

  @Column({ default: true })
  enabled: boolean;

  // ----------------------------------------------------------------- cota
  // A cota do EchoTik é mensal e não recupera. Guardamos o consumo no banco
  // (e não em memória) para sobreviver a restart e deploy.

  /** Mês de referência do contador, no formato "YYYY-MM". */
  @Column({ type: 'varchar', length: 7, default: '' })
  apiMonthKey: string;

  /** Requests já gastos no mês corrente. */
  @Column({ type: 'int', default: 0 })
  apiRequestsUsed: number;

  /** Teto mensal contratado. 0 = sem limite configurado. */
  @Column({ type: 'int', default: 0 })
  apiMonthlyBudget: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
