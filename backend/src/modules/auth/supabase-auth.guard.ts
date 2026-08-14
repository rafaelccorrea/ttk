import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify, JwtPayload } from 'jsonwebtoken';
import { AuthUser } from './auth-user';
import { UsersService } from '../users/users.service';

/**
 * Valida o Bearer token da requisição.
 * Aceita tokens do Supabase Auth (assinados com SUPABASE_JWT_SECRET, HS256)
 * e, em desenvolvimento, tokens locais do dev-login (assinados com JWT_SECRET).
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException('Token ausente');
    }

    const payload = this.verifyWithAnySecret(token);
    const user: AuthUser = {
      id: String(payload.sub),
      email: String(payload.email ?? ''),
    };
    if (!user.id) {
      throw new UnauthorizedException('Token sem subject');
    }

    // Garante o registro de perfil (multi-usuário: nada é fixo).
    await this.usersService.ensure(user);
    request.user = user;
    return true;
  }

  private verifyWithAnySecret(token: string): JwtPayload {
    const secrets = [
      this.config.get<string>('SUPABASE_JWT_SECRET'),
      this.config.get<string>('JWT_SECRET'),
    ].filter((s): s is string => Boolean(s));

    for (const secret of secrets) {
      try {
        return verify(token, secret) as JwtPayload;
      } catch {
        // tenta o próximo secret
      }
    }
    throw new UnauthorizedException('Token inválido ou expirado');
  }
}
