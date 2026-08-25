import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../users/entities/app-user.entity';

/**
 * Só conta SEM assinatura passa por aqui.
 *
 * Parece contraintuitivo barrar quem paga, mas é proteção de quem paga: a rota
 * gratuita devolve a versão reduzida do dado (faixa em vez de número, sem loja,
 * sem link, sem série), e se um assinante caísse nela por um erro de UI ele
 * veria o produto pelo qual pagou degradado, em silêncio, sem nada na tela
 * explicando por quê. O 403 transforma esse bug de UI num erro barulhento — que
 * é o que ele precisa ser para alguém consertar.
 *
 * Use SEMPRE depois do SupabaseAuthGuard: sem `request.user`, não há plano a
 * consultar.
 */
@Injectable()
export class FreePlanGuard implements CanActivate {
  constructor(
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (!request.user?.id) return true; // o auth guard já barrou antes
    const user: AppUser | null =
      request.appUser ?? (await this.users.findOneBy({ id: request.user.id }));
    /*
     * `free` é o único plano que entra. Conta inexistente cai no mesmo caminho
     * (`?? 'free'`) porque a amostra não expõe nada que valha proteger — negar
     * aqui só produziria um erro confuso em cima de outro.
     */
    if ((user?.plan ?? 'free') !== 'free') {
      throw new ForbiddenException(
        'Sua assinatura dá acesso ao catálogo completo — use as telas de Produtos e Vídeos.',
      );
    }
    return true;
  }
}
