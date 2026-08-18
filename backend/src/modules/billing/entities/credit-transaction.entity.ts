import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type TransactionKind =
  | 'signup_bonus'
  | 'plan_grant'
  | 'purchase'
  | 'spend'
  | 'refund'
  // Indicação: bônus de quem indicou e boas-vindas de quem foi indicado.
  | 'referral_bonus'
  | 'referral_welcome';

// Extrato imutável de créditos — todo débito/crédito passa por aqui.
@Entity('credit_transactions')
export class CreditTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  // Positivo = crédito; negativo = débito.
  @Column('int')
  amount: number;

  @Column('int')
  balanceAfter: number;

  @Column()
  kind: TransactionKind;

  // Ação de IA (script, analyze, transcribe, image, video) quando kind=spend/refund.
  @Column({ nullable: true })
  action: string;

  // pack/plan id quando compra ou grant.
  @Column({ nullable: true })
  reference: string;

  @Column({ nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;
}
