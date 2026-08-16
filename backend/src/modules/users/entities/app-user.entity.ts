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
  @Index('IDX_app_users_email', { unique: true })
  @Column()
  email: string;

  @Column({ nullable: true })
  displayName: string;

  /** Foto de perfil no nosso bucket. Nula enquanto ele nao enviar nenhuma. */
  @Column({ type: 'text', nullable: true })
  avatarUrl: string | null;

  // 'free' aqui não é um plano vendável: é "conta criada, pagamento pendente".
  @Column({ default: 'free' })
  plan: string;

  // Cliente correspondente no Stripe. Guardado no primeiro checkout para que a
  // assinatura tenha dono dos dois lados: sem isso não dá para abrir o Billing
  // Portal (cancelar, trocar cartão) nem para saber de quem é o webhook de
  // cancelamento, que chega com o customer e não com o nosso userId.
  //
  // Quem controla o fim do acesso é o próprio Stripe: cancelar não corta na
  // hora (o cliente pagou o mês), e o evento `customer.subscription.deleted` só
  // chega quando o período pago de fato termina. Por isso não guardamos data de
  // expiração deste lado — seria estado duplicado que ninguém mantém.
  @Column({ type: 'text', nullable: true })
  @Index('IDX_app_users_stripeCustomerId')
  stripeCustomerId: string | null;

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
  @Index('IDX_app_users_resetTokenHash')
  resetTokenHash: string;

  @Column({ type: 'timestamptz', nullable: true })
  resetTokenExpiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resetSentAt: Date;

  // Lista de espera (soft launch). Preenchido no cadastro enquanto
  // WAITLIST_MODE=true: a conta é criada e o token de confirmação fica
  // guardado, mas o e-mail só sai quando a vez do usuário chega.
  // Volta a null no release — quem já foi liberado não está mais na fila.
  @Column({ type: 'timestamptz', nullable: true })
  @Index('IDX_app_users_waitlistedAt')
  waitlistedAt: Date;

  // Quando o link de confirmação foi efetivamente enviado no release.
  // Serve de trilha: distingue "nunca liberado" de "liberado e não confirmou".
  @Column({ type: 'timestamptz', nullable: true })
  waitlistReleasedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
