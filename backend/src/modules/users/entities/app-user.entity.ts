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

  /*
   * `sub` do id_token do Google (login social). É o identificador estável da
   * conta Google — o e-mail pode mudar lá, e o vínculo precisa sobreviver.
   * Nulo para quem só usa senha. O índice único (parcial, no banco) garante
   * que uma conta Google não abre duas contas aqui.
   */
  @Column({ type: 'text', nullable: true })
  googleId: string | null;

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

  /*
   * Saldo de minutos de copiloto AO VIVO — a segunda moeda da conta.
   *
   * Separado de `credits` de propósito: crédito é unidade de trabalho da
   * plataforma (um roteiro, uma imagem), comprada e comparada item a item;
   * hora de live é tempo de transmissão, e o vendedor precisa saber quanto
   * ainda tem antes de ligar o copiloto, não quanto vai queimar por minuto.
   * Também protege a cota do mês: uma live longa não pode comer os créditos
   * reservados para produzir criativos.
   *
   * Guardado em minutos, e não em horas, porque é a menor unidade que a gente
   * cobra — e inteiro evita saldo fracionado que nunca fecha na conta do
   * cliente. A venda continua sendo por hora (ver `LIVE_HOUR_PACKS`).
   */
  @Column('int', { default: 0 })
  liveMinutes: number;

  /*
   * Quando a cortesia de estreia do Live Copilot foi concedida.
   *
   * É a trava de "uma vez por conta": os dez minutos entram no `liveMinutes`
   * como qualquer hora comprada, então esta data é a única coisa que distingue
   * quem ainda não ganhou de quem já ganhou e gastou.
   */
  @Column({ type: 'timestamptz', nullable: true })
  liveTrialGrantedAt: Date | null;

  /*
   * O MAIOR bônus de adesão de plano já concedido, em minutos ("já começa com
   * X horas"). É o que faz a renovação não conceder de novo e o upgrade
   * conceder só a diferença — ver `grantSignupLiveHours`.
   */
  @Column('int', { default: 0 })
  liveSignupMinutesGranted: number;

  /*
   * Quando o vendedor aceitou o termo de risco do envio automático no chat da
   * live.
   *
   * Não é formalidade de jurídico: automatizar comentário viola os Termos do
   * TikTok, e o que está em jogo é a conta de onde ele vende — não a nossa. O
   * modo automático é recusado enquanto esta data for nula, e a data fica
   * guardada porque "ele foi avisado" precisa ter hora, não ser uma lembrança
   * de suporte. Nula significa que a conta só pode operar em modo painel.
   */
  @Column({ type: 'timestamptz', nullable: true })
  liveAutoAcceptedAt: Date | null;

  /*
   * A VERSÃO do termo que ele leu quando aceitou.
   *
   * A data sozinha diria que alguém clicou em algum aviso, algum dia. Quando o
   * texto mudar — porque o risco mudou, ou porque o TikTok mudou de postura —,
   * quem aceitou a redação anterior consentiu com outra coisa, e é esta coluna
   * que impede o aceite antigo de autorizar em silêncio a prática nova. O modo
   * automático só é liberado para quem aceitou a versão VIGENTE.
   */
  @Column({ type: 'varchar', nullable: true })
  liveAutoAcceptedVersion: string | null;

  /*
   * Quem indicou esta conta (id do indicador). Gravado no CADASTRO, a partir
   * do `?ref=` do link — o vínculo precisa nascer junto com a conta, porque
   * depois do pagamento não há mais como saber de onde a pessoa veio.
   *
   * Só é preenchido uma vez: reindicar uma conta que já tem dono seria a
   * fraude óbvia (o próprio indicado trocando o link antes de pagar).
   */
  @Column({ type: 'uuid', nullable: true })
  @Index('IDX_app_users_referredBy')
  referredBy: string | null;

  /*
   * Quando a recompensa da indicação foi paga (créditos para quem indicou e
   * para quem foi indicado).
   *
   * É a trava de "uma vez por indicado": o pagamento acontece na PRIMEIRA
   * assinatura confirmada, e sem esta data a renovação mensal — que passa
   * pelo mesmo caminho de crédito — pagaria o bônus todo mês, para sempre.
   */
  @Column({ type: 'timestamptz', nullable: true })
  referralRewardedAt: Date | null;

  /**
   * Última vez que a conta bateu na API autenticada. Gravado pelo guard com
   * folga de alguns minutos (ver `UsersService.ensure`) — é "quando esteve
   * aqui", não um log de requisições. O `updatedAt` não serve para isso: ele
   * mexe quando um webhook troca o plano, e a pessoa pode nem ter aberto o app.
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
