import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { adminEmails, isAdmin } from './admin.access';
import { AdminGuard } from './admin.guard';

const contexto = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user, method: 'GET', url: '/api/v1/admin/users' }),
    }),
  }) as ExecutionContext;

describe('admin — quem entra na área restrita', () => {
  const original = process.env.ADMIN_EMAILS;
  const guard = new AdminGuard();

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'chefe@pikpok.app, Outro@PikPok.app ';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = original;
  });

  it('deixa passar quem está na lista, ignorando caixa e espaços', () => {
    expect(guard.canActivate(contexto({ email: 'chefe@pikpok.app' }))).toBe(true);
    expect(guard.canActivate(contexto({ email: 'OUTRO@pikpok.app' }))).toBe(true);
    expect(guard.canActivate(contexto({ email: '  chefe@pikpok.app  ' }))).toBe(
      true,
    );
  });

  it('barra usuário comum, mesmo autenticado', () => {
    expect(() => guard.canActivate(contexto({ email: 'cliente@gmail.com' }))).toThrow(
      ForbiddenException,
    );
  });

  it('nega quando não há usuário na requisição', () => {
    // Se o guard de autenticação não rodou antes, o correto é fechar a porta —
    // e não seguir adiante como o gate de plano faz.
    expect(() => guard.canActivate(contexto(undefined))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(contexto({}))).toThrow(ForbiddenException);
  });

  it('não promove ninguém quando a variável está vazia', () => {
    delete process.env.ADMIN_EMAILS;
    expect(adminEmails()).toEqual([]);
    expect(isAdmin('chefe@pikpok.app')).toBe(false);
    expect(() => guard.canActivate(contexto({ email: 'chefe@pikpok.app' }))).toThrow(
      ForbiddenException,
    );
  });

  it('não confunde e-mail vazio ou ausente com admin', () => {
    process.env.ADMIN_EMAILS = 'chefe@pikpok.app';
    expect(isAdmin('')).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it('não deixa um e-mail parecido entrar', () => {
    // Prefixo/sufixo não bastam: a comparação é do endereço inteiro.
    expect(isAdmin('chefe@pikpok.app.br')).toBe(false);
    expect(isAdmin('nao-chefe@pikpok.app')).toBe(false);
    expect(isAdmin('chefe@pikpok.ap')).toBe(false);
  });
});
