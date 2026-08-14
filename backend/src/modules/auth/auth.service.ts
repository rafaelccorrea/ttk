import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { sign } from 'jsonwebtoken';

@Injectable()
export class AuthService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Modo demo: emite um JWT local para desenvolvimento sem projeto Supabase.
   * O id do usuário é derivado do e-mail (determinístico), então cada e-mail
   * é um usuário distinto — nada é fixo.
   */
  devLogin(email: string): { accessToken: string; userId: string } {
    if (this.config.get('ALLOW_DEV_LOGIN') !== 'true') {
      throw new ForbiddenException('dev-login desabilitado');
    }
    const hash = createHash('sha256').update(email.toLowerCase()).digest('hex');
    // UUID v4-like determinístico a partir do e-mail
    const userId = [
      hash.slice(0, 8),
      hash.slice(8, 12),
      '4' + hash.slice(13, 16),
      '8' + hash.slice(17, 20),
      hash.slice(20, 32),
    ].join('-');

    const accessToken = sign(
      { sub: userId, email },
      this.config.get<string>('JWT_SECRET', 'change-me'),
      { expiresIn: this.config.get('JWT_EXPIRES_IN', '7d') },
    );
    return { accessToken, userId };
  }
}
