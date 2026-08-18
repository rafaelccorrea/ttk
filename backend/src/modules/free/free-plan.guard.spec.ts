import { ForbiddenException } from '@nestjs/common';
import { FreePlanGuard } from './free-plan.guard';

describe('FreePlanGuard', () => {
  const contexto = (userId?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => (userId ? { user: { id: userId } } : {}),
      }),
    }) as any;

  const comPlano = (plan: string | null) =>
    new FreePlanGuard({
      findOneBy: jest.fn(() => Promise.resolve(plan ? { plan } : null)),
    } as any);

  it('deixa passar quem não assinou', async () => {
    await expect(comPlano('free').canActivate(contexto('u1'))).resolves.toBe(
      true,
    );
  });

  // A rota reduzida não pode degradar em silêncio o produto de quem pagou.
  it('barra quem tem assinatura ativa', async () => {
    for (const plano of ['essencial', 'pro', 'business', 'starter']) {
      await expect(comPlano(plano).canActivate(contexto('u1'))).rejects.toThrow(
        ForbiddenException,
      );
    }
  });

  it('não decide nada sem usuário: quem barra é o auth guard', async () => {
    await expect(comPlano(null).canActivate(contexto())).resolves.toBe(true);
  });
});
