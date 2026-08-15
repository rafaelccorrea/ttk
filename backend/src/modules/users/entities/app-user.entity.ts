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

  // Recuperação de senha. Guardamos o SHA-256 do token, não o token em si —
  // o valor cru só existe no link enviado por e-mail, então um vazamento do
  // banco não permite redefinir a senha de ninguém.
  @Column({ nullable: true })
  @Index()
  resetTokenHash: string;

  @Column({ type: 'timestamptz', nullable: true })
  resetTokenExpiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resetSentAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
