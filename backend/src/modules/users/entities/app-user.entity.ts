import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// Perfil local do usuário. O id é o mesmo uid do Supabase Auth (sub do JWT).
@Entity('app_users')
export class AppUser {
  @PrimaryColumn('uuid')
  id: string;

  // Único: uma conta por e-mail. Sem isso, tokens com sub diferente criavam
  // contas duplicadas e o login encontrava a errada.
  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ nullable: true })
  displayName: string;

  @Column({ default: 'free' })
  plan: string;

  // Saldo de créditos de IA. Todo débito/crédito é registrado em credit_transactions.
  @Column('int', { default: 0 })
  credits: number;

  // Auth local (cadastro por senha com confirmação de e-mail via Nodemailer).
  @Column({ nullable: true })
  passwordHash: string;

  @Column({ type: 'timestamptz', nullable: true })
  emailConfirmedAt: Date;

  @Column({ nullable: true })
  @Index()
  confirmationToken: string;

  @Column({ type: 'timestamptz', nullable: true })
  confirmationSentAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
