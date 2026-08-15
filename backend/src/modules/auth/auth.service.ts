import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import { IsNull, Not, Repository } from 'typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { MailService } from './mail.service';

const RESEND_COOLDOWN_MS = 60_000;
const RESET_TOKEN_TTL_MS = 60 * 60_000; // 1 hora

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly mailService: MailService,
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
  ) {}

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

  private issueToken(user: Pick<AppUser, 'id' | 'email'>): string {
    return sign({ sub: user.id, email: user.email }, this.jwtSecret, {
      expiresIn: this.config.get('JWT_EXPIRES_IN', '7d'),
      algorithm: 'HS256',
      // Marca a origem do token: o guard só aceita HS256 emitido por nós.
      issuer: 'pikpok-api',
      audience: 'pikpok-app',
    });
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
  async register(email: string, password: string) {
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

    if (this.waitlistMode) {
      // Recadastro do mesmo e-mail não reinicia a fila: quem já esperava
      // mantém a posição conquistada.
      user.waitlistedAt ??= new Date();
      // confirmationSentAt fica nulo de propósito — nada foi enviado ainda.
      await this.users.save(user);

      return {
        message: 'Você entrou na lista de espera!',
        waitlisted: true,
        position: await this.waitlistPosition(user),
        total: await this.users.count({ where: { waitlistedAt: Not(IsNull()) } }),
      };
    }

    user.confirmationSentAt = new Date();
    await this.users.save(user);

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
    return { waitlist: this.waitlistMode };
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
    if (!user?.passwordHash || !(await compare(password, user.passwordHash))) {
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
    await this.users.save(user);

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
  devLogin(email: string): { accessToken: string; userId: string } {
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
    return { accessToken: this.issueToken({ id: userId, email }), userId };
  }
}
