import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { decode, JwtPayload, sign, verify } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { IsNull, Not, Repository } from 'typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { NovaContaService } from '../users/nova-conta.service';
import { UsersService } from '../users/users.service';
import { MailService } from './mail.service';

const RESEND_COOLDOWN_MS = 60_000;
const RESET_TOKEN_TTL_MS = 60 * 60_000; // 1 hora

/**
 * Hash de uma senha que não é de ninguém, usado só para gastar o mesmo tempo
 * de bcrypt quando o e-mail não existe — ver `login`. É um valor público de
 * propósito: ele nunca protege nada, só ocupa o relógio.
 */
const HASH_DESCARTAVEL =
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /*
   * Chaves públicas do Google para validar o id_token do login social.
   * Cacheadas: o Google rotaciona as chaves, mas não a cada requisição.
   */
  private readonly googleJwks = new JwksClient({
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    cache: true,
    cacheMaxAge: 10 * 60 * 1000,
  });

  constructor(
    private readonly config: ConfigService,
    private readonly mailService: MailService,
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
    private readonly novaConta: NovaContaService,
    // Só para `invalidar()`: o guard mantém o registro da conta em memória por
    // 30 s, e uma revogação que espera esse prazo não é uma revogação.
    private readonly usersService: UsersService,
  ) {}

  /** Aviso à equipe de que uma linha nova de `app_users` acabou de nascer. */
  private async avisarContaNova(
    user: AppUser,
    origem: 'senha' | 'google',
    naFila: boolean,
  ): Promise<void> {
    const indicador = user.referredBy
      ? await this.users.findOne({ where: { id: user.referredBy }, select: { id: true, email: true } })
      : null;
    this.novaConta.avisar({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      origem,
      naFila,
      indicadoPor: indicador?.email ?? null,
    });
  }

  /**
   * Sem fallback de propósito. Um default tipo "change-me" faz o app subir
   * feliz e assinar tokens com um segredo público — qualquer um forjaria um
   * JWT com o `sub` de outra pessoa. Melhor a requisição falhar.
   */
  private get jwtSecret(): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET ausente ou fraco (mínimo 32 caracteres).');
    }
    return secret;
  }

  private issueToken(
    user: Pick<AppUser, 'id' | 'email' | 'tokenVersion'>,
  ): string {
    // `tv`: a geração da sessão. O guard compara com o valor guardado na conta
    // e recusa o token quando eles divergem — ver `AppUser.tokenVersion`.
    return sign(
      { sub: user.id, email: user.email, tv: user.tokenVersion ?? 0 },
      this.jwtSecret,
      {
        expiresIn: this.config.get('JWT_EXPIRES_IN', '7d'),
        algorithm: 'HS256',
        // Marca a origem do token: o guard só aceita HS256 emitido por nós.
        issuer: 'pikpok-api',
        audience: 'pikpok-app',
      },
    );
  }

  /**
   * Token para o app desktop, emitido no fim do device code flow.
   *
   * É de propósito o MESMO mecanismo do login por senha — mesmo segredo, mesmo
   * `issuer`/`audience` — porque o guard já aceita esse formato no caminho 3.
   * Um token com outra assinatura exigiria mexer no guard, e mexer no guard
   * significa criar um segundo jeito de entrar na API.
   *
   * Muda só o que precisa mudar: a claim `device` marca a origem (útil para
   * auditoria e para uma revogação futura saber o que revogar) e o prazo é
   * longo, porque ninguém abre o app de live para refazer login toda semana —
   * o contrapeso é a autorização ser de uso único e revogável no banco.
   */
  issueDeviceToken(
    user: Pick<AppUser, 'id' | 'email' | 'tokenVersion'>,
    expiresInSeconds: number,
  ): string {
    return sign(
      {
        sub: user.id,
        email: user.email,
        device: true,
        tv: user.tokenVersion ?? 0,
      },
      this.jwtSecret,
      {
        expiresIn: expiresInSeconds,
        algorithm: 'HS256',
        issuer: 'pikpok-api',
        audience: 'pikpok-app',
      },
    );
  }

  private confirmationLink(token: string): string {
    const appUrl = this.config
      .get('APP_URL', 'http://localhost:5173')
      .replace(/\/$/, '');
    return `${appUrl}/confirmar-email?token=${token}`;
  }

  private resetLink(token: string): string {
    const appUrl = this.config
      .get('APP_URL', 'http://localhost:5173')
      .replace(/\/$/, '');
    return `${appUrl}/redefinir-senha?token=${token}`;
  }

  /** O banco guarda só o hash; o token cru vive apenas no link do e-mail. */
  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Soft launch: cadastros entram em fila e o e-mail sai no release. */
  private get waitlistMode(): boolean {
    return this.config.get('WAITLIST_MODE') === 'true';
  }

  /**
   * Posição real na fila — quantos entraram antes (ou junto) e ainda não
   * foram liberados. É contagem de verdade, não número decorativo.
   */
  private async waitlistPosition(user: AppUser): Promise<number> {
    return this.users
      .createQueryBuilder('u')
      .where('u."waitlistedAt" IS NOT NULL')
      .andWhere('u."waitlistedAt" <= :mine', { mine: user.waitlistedAt })
      .getCount();
  }

  /**
   * Cadastro. Com WAITLIST_MODE=true a conta é criada e o token de
   * confirmação fica guardado, mas o e-mail NÃO sai agora — ele é enviado
   * quando a vez do usuário chegar (npm run waitlist:release).
   */
  async register(email: string, password: string, ref?: string) {
    const normalized = email.toLowerCase().trim();
    const existing = await this.users.findOneBy({ email: normalized });
    if (existing?.emailConfirmedAt && existing.passwordHash) {
      throw new ConflictException('Este e-mail já tem conta confirmada.');
    }

    const passwordHash = await hash(password, 10);
    const confirmationToken = randomBytes(32).toString('hex');
    const user =
      existing ??
      this.users.create({ id: randomUUID(), email: normalized });
    user.passwordHash = passwordHash;
    user.confirmationToken = confirmationToken;

    /*
     * Vínculo de indicação. Só grava quando ainda não há um: recadastro do
     * mesmo e-mail com outro `?ref=` não troca o dono da indicação — senão o
     * próprio indicado escolheria a dedo quem leva os créditos, e um
     * concorrente roubaria indicações alheias mandando o link certo na hora
     * certa.
     *
     * Indicar a si mesmo é recusado, e um ref que não existe é ignorado em
     * silêncio: link velho não pode impedir alguém de criar a conta.
     */
    if (ref && !user.referredBy && ref !== user.id) {
      const indicador = await this.users.findOneBy({ id: ref });
      if (indicador) user.referredBy = indicador.id;
    }

    if (this.waitlistMode) {
      // Recadastro do mesmo e-mail não reinicia a fila: quem já esperava
      // mantém a posição conquistada.
      user.waitlistedAt ??= new Date();
      // confirmationSentAt fica nulo de propósito — nada foi enviado ainda.
      await this.users.save(user);
      if (!existing) await this.avisarContaNova(user, 'senha', true);

      return {
        message: 'Você entrou na lista de espera!',
        waitlisted: true,
        position: await this.waitlistPosition(user),
        total: await this.users.count({ where: { waitlistedAt: Not(IsNull()) } }),
      };
    }

    user.confirmationSentAt = new Date();
    await this.users.save(user);
    // Avisa já no cadastro, não na confirmação: quem não confirma também é
    // informação ("cadastrou e sumiu" aparece no painel com esse selo).
    if (!existing) await this.avisarContaNova(user, 'senha', false);

    const sent = await this.mailService.sendConfirmationEmail(
      normalized,
      this.confirmationLink(confirmationToken),
    );
    return {
      message:
        'Cadastro criado. Enviamos um link de confirmação para o seu e-mail.',
      waitlisted: false,
      previewUrl: sent.previewUrl,
    };
  }

  /** Config que o frontend pode ler sem autenticar. */
  publicConfig() {
    return {
      waitlist: this.waitlistMode,
      // O client ID do Google não é segredo (vai no HTML de qualquer site que
      // usa o botão). Servir daqui evita duplicar o valor num env do frontend
      // — e sem ele configurado o botão simplesmente não aparece.
      googleClientId: this.config.get<string>('GOOGLE_CLIENT_ID') || null,
    };
  }

  /**
   * Login/cadastro com Google. Recebe o `credential` (id_token JWT) que o
   * Google Identity Services entrega no navegador e valida do nosso lado:
   * assinatura via JWKS do Google, `aud` igual ao nosso client ID e `iss` do
   * Google. Confiar no payload sem validar seria aceitar qualquer JWT forjado.
   */
  private async verifyGoogleIdToken(credential: string): Promise<JwtPayload> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new BadRequestException('Login com Google não está habilitado.');
    }
    const decoded = decode(credential, { complete: true });
    const kid = decoded?.header?.kid;
    if (!kid) {
      throw new UnauthorizedException('Token do Google inválido.');
    }
    try {
      const key = await this.googleJwks.getSigningKey(kid);
      return verify(credential, key.getPublicKey(), {
        algorithms: ['RS256'],
        audience: clientId,
        issuer: ['accounts.google.com', 'https://accounts.google.com'],
      }) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Token do Google inválido ou expirado.');
    }
  }

  async loginWithGoogle(credential: string, ref?: string) {
    const payload = await this.verifyGoogleIdToken(credential);
    const googleId = String(payload.sub);
    const email = String(payload.email ?? '')
      .toLowerCase()
      .trim();
    // Sem e-mail verificado não dá para vincular por e-mail: alguém criaria
    // uma conta Google com o e-mail de outra pessoa e entraria na conta dela.
    if (!email || payload.email_verified !== true) {
      throw new UnauthorizedException(
        'Sua conta Google não tem e-mail verificado.',
      );
    }

    // Primeiro pelo vínculo estável (sub), depois pelo e-mail — que cobre
    // tanto quem já tinha conta por senha quanto o primeiro login social.
    let user = await this.users.findOneBy({ googleId });
    user ??= await this.users.findOneBy({ email });

    const isNew = !user;
    user ??= this.users.create({ id: randomUUID(), email });
    user.googleId ??= googleId;
    if (!user.displayName && payload.name) {
      user.displayName = String(payload.name);
    }
    if (!user.avatarUrl && payload.picture) {
      user.avatarUrl = String(payload.picture);
    }

    // Mesmas regras do register(): só grava indicação quando ainda não há
    // uma, e auto-indicação é recusada.
    if (ref && !user.referredBy && ref !== user.id) {
      const indicador = await this.users.findOneBy({ id: ref });
      if (indicador) user.referredBy = indicador.id;
    }

    // Soft launch: conta NOVA via Google entra na fila como qualquer outra —
    // o botão do Google não pode ser a porta que fura a lista de espera.
    // Quem já estava na fila também não entra por aqui antes da vez chegar.
    // Importante: sem confirmar o e-mail aqui, senão o login por senha
    // deixaria de barrar essa conta enquanto ela espera.
    if (this.waitlistMode && (isNew || user.waitlistedAt)) {
      user.waitlistedAt ??= new Date();
      await this.users.save(user);
      if (isNew) await this.avisarContaNova(user, 'google', true);
      return {
        message: 'Você entrou na lista de espera!',
        waitlisted: true as const,
        position: await this.waitlistPosition(user),
        total: await this.users.count({ where: { waitlistedAt: Not(IsNull()) } }),
      };
    }

    // Google já verificou o e-mail — o fluxo de confirmação nosso seria
    // pedir para provar de novo o que acabou de ser provado.
    const primeiraAtivacao = !user.emailConfirmedAt;
    user.emailConfirmedAt ??= new Date();
    user.confirmationToken = null as unknown as string;

    await this.users.save(user);
    if (isNew) await this.avisarContaNova(user, 'google', false);
    if (primeiraAtivacao) this.sendWelcome(user);
    return {
      accessToken: this.issueToken(user),
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }

  /**
   * Boas-vindas em segundo plano: falha no SMTP não pode derrubar a ativação
   * da conta, então só registra no log.
   */
  private sendWelcome(user: { email: string; displayName?: string }): void {
    void this.mailService
      .sendWelcomeEmail(user.email, user.displayName)
      .catch((err: unknown) =>
        this.logger.warn(
          `Falha ao enviar boas-vindas para ${user.email}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /** Contagens da fila, para o script de gestão. */
  async waitlistStatus() {
    const [waiting, released, confirmed] = await Promise.all([
      this.users.count({ where: { waitlistedAt: Not(IsNull()) } }),
      this.users.count({
        where: { waitlistReleasedAt: Not(IsNull()), emailConfirmedAt: IsNull() },
      }),
      this.users.count({ where: { emailConfirmedAt: Not(IsNull()) } }),
    ]);
    return { waiting, released, confirmed };
  }

  /**
   * Libera os `limit` mais antigos da fila: envia o link de confirmação que
   * ficou guardado desde o cadastro e tira a pessoa da fila.
   *
   * Envia um a um, de propósito. Se um e-mail falha, só ele volta para a fila
   * — o lote inteiro não é perdido e ninguém recebe dois links.
   */
  async releaseWaitlist(
    limit: number,
    onEach?: (email: string, ok: boolean, erro?: string) => void,
  ) {
    const batch = await this.users.find({
      where: { waitlistedAt: Not(IsNull()) },
      order: { waitlistedAt: 'ASC' },
      take: limit,
    });

    let sent = 0;
    let failed = 0;

    for (const user of batch) {
      // Cadastro antigo sem token (ou já usado) ganha um novo.
      user.confirmationToken ||= randomBytes(32).toString('hex');
      try {
        await this.mailService.sendConfirmationEmail(
          user.email,
          this.confirmationLink(user.confirmationToken),
        );
        user.waitlistedAt = null as unknown as Date;
        user.waitlistReleasedAt = new Date();
        user.confirmationSentAt = new Date();
        await this.users.save(user);
        sent += 1;
        onEach?.(user.email, true);
      } catch (err) {
        // Continua na fila — entra no próximo lote.
        failed += 1;
        onEach?.(user.email, false, (err as Error).message);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    return {
      sent,
      failed,
      remaining: await this.users.count({
        where: { waitlistedAt: Not(IsNull()) },
      }),
    };
  }

  /** Login por senha — exige e-mail confirmado. */
  async login(email: string, password: string) {
    const user = await this.users.findOneBy({
      email: email.toLowerCase().trim(),
    });
    /*
     * O bcrypt roda MESMO quando a conta não existe.
     *
     * A mensagem já é genérica ("e-mail ou senha incorretos"), mas o tempo de
     * resposta não era: sem `passwordHash`, o `||` curto-circuitava e a
     * resposta voltava em microssegundos; com a conta existindo, o bcrypt
     * custava ~100 ms. Essa diferença é grande, estável e mensurável por
     * qualquer cliente — ou seja, a rota respondia "esse e-mail tem conta aqui"
     * para quem soubesse cronometrar, que é exatamente o que a mensagem
     * genérica existe para não dizer.
     *
     * Comparar contra um hash descartável iguala os dois caminhos. O custo é
     * um bcrypt a mais em tentativa de e-mail inexistente — que o limite de
     * 10 por 5 min já mantém raro.
     */
    const hashParaComparar = user?.passwordHash ?? HASH_DESCARTAVEL;
    const senhaConfere = await compare(password, hashParaComparar);
    if (!user?.passwordHash || !senhaConfere) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }
    // Quem está na fila ainda não recebeu link nenhum — mandar "confirme
    // seu e-mail" faria a pessoa procurar uma mensagem que não existe.
    if (user.waitlistedAt && !user.emailConfirmedAt) {
      throw new ForbiddenException(
        'Você está na lista de espera. Assim que chegar a sua vez, enviaremos o link de confirmação para o seu e-mail.',
      );
    }
    if (!user.emailConfirmedAt) {
      throw new ForbiddenException(
        'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
      );
    }
    return {
      accessToken: this.issueToken(user),
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }

  /** Confirma o e-mail a partir do token do link. */
  async confirm(token: string) {
    if (!token) {
      throw new BadRequestException('Token ausente.');
    }
    const user = await this.users.findOneBy({ confirmationToken: token });
    if (!user) {
      throw new BadRequestException('Link inválido ou já utilizado.');
    }
    user.emailConfirmedAt = new Date();
    user.confirmationToken = null as unknown as string;
    await this.users.save(user);
    this.sendWelcome(user);
    return {
      message: 'E-mail confirmado! Você já pode entrar.',
      accessToken: this.issueToken(user),
      user: { id: user.id, email: user.email },
    };
  }

  /** Reenvia o link de confirmação (cooldown de 60s). */
  async resend(email: string) {
    const user = await this.users.findOneBy({
      email: email.toLowerCase().trim(),
    });
    if (!user?.passwordHash) {
      // Não revela se o e-mail existe.
      return { message: 'Se o e-mail existir, enviaremos um novo link.' };
    }
    if (user.emailConfirmedAt) {
      return { message: 'Este e-mail já está confirmado — pode entrar.' };
    }
    // Na fila não há link para reenviar: o primeiro ainda nem saiu.
    if (user.waitlistedAt) {
      return {
        message:
          'Você já está na lista de espera. O link de confirmação chega quando for a sua vez.',
        waitlisted: true,
        position: await this.waitlistPosition(user),
      };
    }
    const elapsed = user.confirmationSentAt
      ? Date.now() - user.confirmationSentAt.getTime()
      : Infinity;
    if (elapsed < RESEND_COOLDOWN_MS) {
      throw new BadRequestException(
        'Aguarde um minuto antes de pedir outro link.',
      );
    }
    user.confirmationToken = randomBytes(32).toString('hex');
    user.confirmationSentAt = new Date();
    await this.users.save(user);
    const sent = await this.mailService.sendConfirmationEmail(
      user.email,
      this.confirmationLink(user.confirmationToken),
    );
    return { message: 'Novo link enviado.', previewUrl: sent.previewUrl };
  }

  /**
   * Pedido de redefinição de senha. A resposta é sempre a mesma, exista o
   * e-mail ou não — senão a rota vira um enumerador de contas cadastradas.
   */
  async forgotPassword(email: string) {
    const generic = {
      message:
        'Se este e-mail tiver uma conta, enviamos um link para redefinir a senha.',
    };
    const user = await this.users.findOneBy({
      email: email.toLowerCase().trim(),
    });
    // Conta sem senha (criada só via Supabase/dev-login) não tem o que redefinir.
    if (!user?.passwordHash) {
      return generic;
    }
    // Mesmo cooldown do reenvio de confirmação, para não virar canhão de spam.
    const elapsed = user.resetSentAt
      ? Date.now() - user.resetSentAt.getTime()
      : Infinity;
    if (elapsed < RESEND_COOLDOWN_MS) {
      throw new BadRequestException(
        'Aguarde um minuto antes de pedir outro link.',
      );
    }

    const token = randomBytes(32).toString('hex');
    user.resetTokenHash = this.hashResetToken(token);
    user.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    user.resetSentAt = new Date();
    await this.users.save(user);

    const sent = await this.mailService.sendPasswordResetEmail(
      user.email,
      this.resetLink(token),
    );
    return { ...generic, previewUrl: sent.previewUrl };
  }

  /** Troca a senha a partir do token do link. Token é de uso único. */
  async resetPassword(token: string, password: string) {
    if (!token) {
      throw new BadRequestException('Token ausente.');
    }
    const user = await this.users.findOneBy({
      resetTokenHash: this.hashResetToken(token),
    });
    if (!user) {
      throw new BadRequestException(
        'Link inválido ou já utilizado. Peça um novo.',
      );
    }
    if (
      !user.resetTokenExpiresAt ||
      user.resetTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Este link expirou. Peça um novo.');
    }

    user.passwordHash = await hash(password, 10);
    user.resetTokenHash = null as unknown as string;
    user.resetTokenExpiresAt = null as unknown as Date;
    // Quem provou ter acesso à caixa de entrada confirmou o e-mail na prática.
    user.emailConfirmedAt ??= new Date();
    /*
     * Trocar a senha DERRUBA as sessões abertas.
     *
     * Este é o ponto do sistema em que alguém age por desconfiança — "acho que
     * mexeram na minha conta". Antes disto, a troca de senha não fazia nada
     * contra quem já estava dentro: o JWT roubado continuava válido por dias,
     * porque é stateless e não consulta a senha. A pessoa fazia exatamente a
     * coisa certa e o invasor não perdia o acesso.
     *
     * Incrementar a geração invalida todo token emitido antes deste instante —
     * incluindo o do app de desktop, que vale 30 dias. O token novo devolvido
     * abaixo já sai com a geração nova, então quem trocou a senha continua
     * conectado nesta aba e só nela.
     */
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.users.save(user);
    // O guard guarda o registro da conta por 30 s; sem isto a sessão antiga
    // sobreviveria essa janela.
    this.usersService.invalidar(user.id);

    return {
      message: 'Senha alterada! Você já está conectado.',
      accessToken: this.issueToken(user),
      user: { id: user.id, email: user.email },
    };
  }

  /**
   * Modo demo (dev): emite um JWT local sem cadastro nem confirmação.
   * O id é derivado do e-mail — cada e-mail é um usuário distinto.
   */
  async devLogin(
    email: string,
  ): Promise<{ accessToken: string; userId: string }> {
    // Duas travas, não uma. A rota emite um token válido para QUALQUER e-mail
    // sem senha: uma variável de ambiente marcada por engano em produção seria
    // account takeover de todo mundo. NODE_ENV desliga isso incondicionalmente.
    if (this.config.get('NODE_ENV') === 'production') {
      throw new ForbiddenException('dev-login desabilitado');
    }
    if (this.config.get('ALLOW_DEV_LOGIN') !== 'true') {
      throw new ForbiddenException('dev-login desabilitado');
    }
    const digest = createHash('sha256')
      .update(email.toLowerCase())
      .digest('hex');
    const userId = [
      digest.slice(0, 8),
      digest.slice(8, 12),
      '4' + digest.slice(13, 16),
      '8' + digest.slice(17, 20),
      digest.slice(20, 32),
    ].join('-');
    // A geração vem da conta quando ela já existe: emitir sempre `tv: 0` faria
    // o guard recusar o token de um usuário de desenvolvimento que já passou
    // por uma troca de senha.
    const existente = await this.users.findOne({
      where: { id: userId },
      select: { id: true, tokenVersion: true },
    });
    return {
      accessToken: this.issueToken({
        id: userId,
        email,
        tokenVersion: existente?.tokenVersion ?? 0,
      }),
      userId,
    };
  }
}
