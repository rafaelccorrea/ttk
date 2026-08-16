import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { isAdmin } from './admin.access';

/**
 * Use SEMPRE depois do SupabaseAuthGuard:
 * @UseGuards(SupabaseAuthGuard, AdminGuard)
 *
 * Diferente do PlanFeatureGuard, este nega quando não sabe: se a requisição
 * chegar sem usuário (por um guard mal encadeado, por exemplo), a resposta é
 * 403 e não "deixa passar". Num gate de plano, errar para o lado permissivo
 * custa um crédito; aqui custaria a base de usuários inteira.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const email = request.user?.email;
    if (!isAdmin(email)) {
      // Tentativa de acesso à área administrativa merece rastro: ou é engano de
      // rota, ou é alguém sondando.
      this.logger.warn(
        `Acesso administrativo negado para "${email ?? 'sem usuário'}" em ${request.method} ${request.url}`,
      );
      throw new ForbiddenException('Área restrita a administradores.');
    }
    return true;
  }
}
