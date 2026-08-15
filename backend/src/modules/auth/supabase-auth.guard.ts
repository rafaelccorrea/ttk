import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decode, verify, JwtPayload } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { AuthUser } from './auth-user';
import { UsersService } from '../users/users.service';

/**
 * Valida o Bearer token da requisição. Aceita, nesta ordem:
 * 1. Tokens do Supabase Auth assinados com chave assimétrica (ES256/RS256),
 *    validados via JWKS do projeto (SUPABASE_URL) — chaves novas ("publishable").
 * 2. Tokens do Supabase legados (HS256 com SUPABASE_JWT_SECRET).
 * 3. Tokens locais do dev-login (HS256 com JWT_SECRET), em desenvolvimento.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly jwks: JwksClient | null;

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const supabaseUrl = this.config.get<string>('SUPABASE_URL');
    this.jwks = supabaseUrl
      ? new JwksClient({
          jwksUri: `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`,
          cache: true,
          cacheMaxAge: 10 * 60 * 1000,
        })
      : null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException('Token ausente');
    }

    const payload = await this.verifyToken(token);
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

  private async verifyToken(token: string): Promise<JwtPayload> {
    // 1. Chave assimétrica via JWKS (projetos Supabase novos)
    if (this.jwks) {
      const decoded = decode(token, { complete: true });
      const kid = decoded?.header?.kid;
      const alg = decoded?.header?.alg;
      if (kid && alg !== 'HS256') {
        try {
          const key = await this.jwks.getSigningKey(kid);
          return verify(token, key.getPublicKey(), {
            algorithms: ['ES256', 'RS256'],
          }) as JwtPayload;
        } catch {
          throw new UnauthorizedException('Token inválido ou expirado');
        }
      }
    }

    // 2. Supabase legado (HS256 com o secret do projeto).
    const supabaseSecret = this.config.get<string>('SUPABASE_JWT_SECRET');
    if (supabaseSecret) {
      try {
        // `algorithms` fixo: sem ele, a lista aceita é inferida do formato da
        // chave, e um token com header "alg" escolhido pelo atacante decide
        // como é validado. A escolha do algoritmo é nossa, não do token.
        return verify(token, supabaseSecret, {
          algorithms: ['HS256'],
          audience: 'authenticated',
        }) as JwtPayload;
      } catch {
        // tenta o token local
      }
    }

    // 3. Token emitido pela própria API (login por senha e dev-login).
    const localSecret = this.config.get<string>('JWT_SECRET');
    if (localSecret) {
      try {
        return verify(token, localSecret, {
          algorithms: ['HS256'],
          issuer: 'pikpok-api',
          audience: 'pikpok-app',
        }) as JwtPayload;
      } catch {
        // cai no erro genérico abaixo
      }
    }
    throw new UnauthorizedException('Token inválido ou expirado');
  }
}
