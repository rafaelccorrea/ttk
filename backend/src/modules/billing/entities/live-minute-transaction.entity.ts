import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type LiveMinuteKind =
  | 'trial' // cortesia de estreia, uma vez por conta
  | 'purchase' // add-on de horas pago no Stripe
  | 'spend' // transmissão consumida
  | 'refund'; // devolução (a live caiu, o copiloto não entregou)

/**
 * Extrato imutável dos minutos de live — a moeda do copiloto ao vivo.
 *
 * Tabela própria, e não uma coluna de unidade em `credit_transactions`, por
 * duas razões: a de crédito é uma tabela em produção com histórico de clientes,
 * e um extrato que mistura duas moedas é justamente o que a separação das
 * carteiras existe para evitar — o cliente abre o extrato de live e vê horas,
 * sem ter que filtrar lançamentos de imagem e roteiro.
 */
@Entity('live_minute_transactions')
export class LiveMinuteTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_live_minute_transactions_userId')
  @Column('uuid')
  userId: string;

  /** Positivo = minutos creditados; negativo = consumidos. */
  @Column('int')
  minutes: number;

  @Column('int')
  balanceAfter: number;

  @Column()
  kind: LiveMinuteKind;

  /**
   * Id do pacote comprado ou referência do evento do Stripe.
   *
   * Único quando preenchido: é o que impede o webhook de creditar duas vezes o
   * mesmo pagamento quando o Stripe reenvia o evento — e o Stripe reenvia.
   */
  @Index('IDX_live_minute_transactions_reference', { unique: true })
  @Column({ type: 'text', nullable: true })
  reference: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
