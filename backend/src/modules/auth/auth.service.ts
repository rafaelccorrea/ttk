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
import { Repository } from 'typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { MailService } from './mail.service';

const RESEND_COOLDOWN_MS = 60_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly mailService: MailService,
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
  ) {}

  private issueToken(user: Pick<AppUser, 'id' | 'email'>): string {
    return sign(
      { sub: user.id, email: user.email },
      this.config.get<string>('JWT_SECRET', 'change-me'),
      { expiresIn: this.config.get('JWT_EXPIRES_IN', '7d') },
    );
  }

  private confirmationLink(token: string): string {
    const appUrl = this.config
      .get('APP_URL', 'http://localhost:5173')
      .replace(/\/$/, '');
    return `${appUrl}/confirmar-email?token=${token}`;
  }

  /** Cadastro com confirmação de e-mail via Nodemailer. */
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
    user.confirmationSentAt = new Date();
    await this.users.save(user);

    const sent = await this.mailService.sendConfirmationEmail(
      normalized,
      this.confirmationLink(confirmationToken),
    );
    return {
      message:
        'Cadastro criado. Enviamos um link de confirmação para o seu e-mail.',
      previewUrl: sent.previewUrl,
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
   * Modo demo (dev): emite um JWT local sem cadastro nem confirmação.
   * O id é derivado do e-mail — cada e-mail é um usuário distinto.
   */
  devLogin(email: string): { accessToken: string; userId: string } {
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
