import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { SupabaseAuthGuard } from './supabase-auth.guard';

const SEGREDO = 'a'.repeat(48);

function contexto(token?: string) {
  const req: Record<string, any> = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

function tokenLocal(claims: Record<string, unknown>): string {
  return sign(claims, SEGREDO, {
    algorithm: 'HS256',
    expiresIn: '1h',
    issuer: 'pikpok-api',
    audience: 'pikpok-app',
  });
}

describe('SupabaseAuthGuard — revogação por tokenVersion', () => {
  const config: any = {
    get: (chave: string) => (chave === 'JWT_SECRET' ? SEGREDO : undefined),
  };

  function guardCom(tokenVersion: number) {
    const users: any = {
      ensure: jest.fn(async () => ({ id: 'u1', email: 'a@b.c', tokenVersion })),
    };
    return { guard: new SupabaseAuthGuard(config, users), users };
  }

  it('aceita o token cuja geração bate com a da conta', async () => {
    const { guard } = guardCom(3);
    const { ctx, req } = contexto(tokenLocal({ sub: 'u1', email: 'a@b.c', tv: 3 }));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.id).toBe('u1');
  });

  it('recusa o token de uma geração anterior — é a troca de senha derrubando a sessão', async () => {
    const { guard } = guardCom(4);
    const { ctx } = contexto(tokenLocal({ sub: 'u1', email: 'a@b.c', tv: 3 }));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token antigo sem a claim conta como geração 0 e continua valendo', async () => {
    // Compatibilidade: é o token que já estava em circulação quando a coluna
    // foi criada. Ninguém é desconectado pelo deploy.
    const { guard } = guardCom(0);
    const { ctx } = contexto(tokenLocal({ sub: 'u1', email: 'a@b.c' }));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('token antigo sem a claim NÃO passa depois de uma revogação', async () => {
    const { guard } = guardCom(1);
    const { ctx } = contexto(tokenLocal({ sub: 'u1', email: 'a@b.c' }));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('recusa token assinado com outro segredo', async () => {
    const { guard } = guardCom(0);
    const forjado = sign({ sub: 'u1', tv: 0 }, 'b'.repeat(48), {
      algorithm: 'HS256',
      issuer: 'pikpok-api',
      audience: 'pikpok-app',
    });
    const { ctx } = contexto(forjado);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('recusa requisição sem token', async () => {
    const { guard } = guardCom(0);
    const { ctx } = contexto();
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
