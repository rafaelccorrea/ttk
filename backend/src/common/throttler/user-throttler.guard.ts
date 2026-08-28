import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limit por CONTA, não por IP.
 *
 * O guard global do Nest roda antes dos guards de controller, então lá `req.user`
 * ainda não existe e o balde só pode ser o IP. Isso deixa dois furos numa rota
 * autenticada e cara (uma geração de IA, uma transcrição):
 *
 *  - quem tem uma conta e um punhado de IPs (VPN, celular trocando de rede, uma
 *    lista de proxies residenciais) ganha um balde novo a cada troca, e o teto
 *    por IP não vale nada;
 *  - quem está atrás do mesmo NAT que outros clientes — um escritório, uma
 *    operadora com CGNAT — divide o balde com estranhos e leva 429 sem ter
 *    feito nada.
 *
 * Este guard é encadeado DEPOIS do SupabaseAuthGuard, onde `req.user` já foi
 * preenchido: aí o balde passa a ser o `sub` do token, que o atacante não
 * consegue trocar sem outra conta. O IP continua sendo a chave quando não há
 * usuário, para a rota anônima não ficar sem teto nenhum.
 *
 * Usar os dois é de propósito: o guard global segue cobrando por IP e este cobra
 * por conta. São dimensões diferentes do mesmo abuso, e nenhuma sozinha cobre a
 * outra.
 *
 * > Limitação: o armazenamento padrão do @nestjs/throttler é a memória do
 * > processo. Com mais de uma instância atrás de um load balancer, cada uma tem
 * > o seu contador e o teto efetivo é `limite × instâncias`. Para valer no
 * > agregado, troque por `ThrottlerStorageRedisService` mantendo estas chaves.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.id;
    if (typeof userId === 'string' && userId) return `user:${userId}`;
    // `req.ip` só é o IP real do cliente porque `trust proxy` está configurado
    // no boot (ver `main.ts`); sem isso todo mundo compartilharia o IP do proxy.
    return `ip:${req?.ip ?? 'desconhecido'}`;
  }
}
