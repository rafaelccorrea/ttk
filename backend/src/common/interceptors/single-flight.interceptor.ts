import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Observable, from } from 'rxjs';

/**
 * Trava de requisição em voo para rotas que gastam crédito/token do usuário.
 *
 * O `disabled` do botão no frontend é conforto de UX, não controle: ele não
 * sobrevive a duplo-clique rápido (o React só desabilita no próximo render),
 * a duas abas abertas, a um retry de rede, nem a alguém chamando a API direto.
 * Cada requisição repetida que passa é uma cobrança a mais no usuário e uma
 * chamada paga a mais no provedor de IA.
 *
 * Aqui, duas requisições idênticas (mesmo usuário + rota + corpo) do mesmo
 * usuário não rodam em paralelo: a segunda recebe a MESMA promessa da primeira.
 * Ou seja, o duplo-clique devolve o mesmo resultado, cobrando uma vez só —
 * em vez de estourar um erro que o usuário leria como falha.
 *
 * Escopo: memória do processo. Com mais de uma instância atrás de um load
 * balancer, isso vira "uma trava por instância" — nesse cenário troque o Map
 * por Redis (SET NX PX) mantendo a mesma chave.
 */
@Injectable()
export class SingleFlightInterceptor implements NestInterceptor {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    // Sem usuário identificado não há o que deduplicar com segurança: duas
    // pessoas atrás do mesmo NAT compartilhariam a trava.
    if (!userId) {
      return next.handle();
    }

    const key = this.buildKey(userId, request);
    const running = this.inFlight.get(key);
    if (running) {
      return from(running);
    }

    // toPromise via lastValueFrom seria import extra; o handler devolve um
    // Observable de valor único, então isso é equivalente e sem dependência.
    const promise = new Promise<unknown>((resolve, reject) => {
      next.handle().subscribe({ next: resolve, error: reject });
    }).finally(() => {
      // Só limpa depois de terminar: enquanto está rodando, todo clone espera
      // a mesma execução. Terminou, a próxima tentativa é legítima (retry
      // consciente do usuário).
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return from(promise);
  }

  private buildKey(userId: string, request: {
    method?: string;
    route?: { path?: string };
    url?: string;
    body?: unknown;
  }): string {
    const route = request.route?.path ?? request.url ?? '';
    // O corpo entra na chave para que dois pedidos DIFERENTES do mesmo usuário
    // (dois produtos, dois prompts) sigam em paralelo — a trava é contra
    // repetição, não contra uso simultâneo legítimo.
    let body = '';
    try {
      body = JSON.stringify(request.body ?? {});
    } catch {
      // Corpo não serializável (upload, referência cíclica): cai para chave
      // só de rota — mais restritivo, e é o lado seguro para errar.
      body = '';
    }
    const digest = createHash('sha256')
      .update(`${userId}|${request.method ?? ''}|${route}|${body}`)
      .digest('hex');
    return digest;
  }
}
