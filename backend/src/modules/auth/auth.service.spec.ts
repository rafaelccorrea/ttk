import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { createHash } from 'crypto';
import { AppUser } from '../users/entities/app-user.entity';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';

describe('AuthService — recuperação de senha', () => {
  let service: AuthService;
  let stored: Partial<AppUser> | null;

  const usersMock = {
    findOneBy: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn((dto) => {
      stored = dto;
      return Promise.resolve(dto);
    }),
  };

  const mailMock = {
    sendPasswordResetEmail: jest.fn(
      (_to: string, _link: string): Promise<Record<string, never>> =>
        Promise.resolve({}),
    ),
  };

  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'APP_URL') return 'https://app.pikpok.test';
      // O serviço recusa segredo curto/ausente de propósito; o teste precisa
      // de um que passe nessa regra.
      if (key === 'JWT_SECRET') return 'x'.repeat(64);
      return fallback;
    }),
  };

  /** Extrai o token cru do link passado ao MailService. */
  const sentToken = () =>
    new URL(mailMock.sendPasswordResetEmail.mock.calls[0][1]).searchParams.get(
      'token',
    ) as string;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: config },
        { provide: MailService, useValue: mailMock },
        { provide: getRepositoryToken(AppUser), useValue: usersMock },
      ],
    }).compile();

    service = module.get(AuthService);
    stored = null;
    jest.clearAllMocks();
  });

  function user(overrides: Partial<AppUser> = {}): Partial<AppUser> {
    return {
      id: 'uuid-1',
      email: 'user@pikpok.test',
      passwordHash: 'hash-antigo',
      emailConfirmedAt: new Date(),
      ...overrides,
    };
  }

  it('envia o link e guarda apenas o hash do token', async () => {
    usersMock.findOneBy.mockResolvedValue(user());

    await service.forgotPassword('User@Pikpok.test');

    const token = sentToken();
    expect(token).toHaveLength(64);
    expect(stored?.resetTokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    // O token cru nunca vai para o banco.
    expect(stored?.resetTokenHash).not.toBe(token);
    expect(stored?.resetTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('responde igual para e-mail inexistente, sem enviar nada', async () => {
    usersMock.findOneBy.mockResolvedValue(null);

    const semConta = await service.forgotPassword('ninguem@pikpok.test');
    usersMock.findOneBy.mockResolvedValue(user());
    const comConta = await service.forgotPassword('user@pikpok.test');

    expect(semConta.message).toBe(comConta.message);
    expect(mailMock.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('aplica cooldown de 60s entre pedidos', async () => {
    usersMock.findOneBy.mockResolvedValue(user({ resetSentAt: new Date() }));

    await expect(service.forgotPassword('user@pikpok.test')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('troca a senha e invalida o token (uso único)', async () => {
    const token = 'a'.repeat(64);
    usersMock.findOneBy.mockResolvedValue(
      user({
        resetTokenHash: createHash('sha256').update(token).digest('hex'),
        resetTokenExpiresAt: new Date(Date.now() + 60_000),
      }),
    );

    const result = await service.resetPassword(token, 'nova-senha-123');

    expect(await compare('nova-senha-123', stored!.passwordHash!)).toBe(true);
    expect(stored?.resetTokenHash).toBeNull();
    expect(result.accessToken).toBeTruthy();
  });

  it('recusa token expirado', async () => {
    const token = 'b'.repeat(64);
    usersMock.findOneBy.mockResolvedValue(
      user({
        resetTokenHash: createHash('sha256').update(token).digest('hex'),
        resetTokenExpiresAt: new Date(Date.now() - 1_000),
      }),
    );

    await expect(service.resetPassword(token, 'nova-senha-123')).rejects.toThrow(
      /expirou/,
    );
  });

  it('recusa token desconhecido', async () => {
    usersMock.findOneBy.mockResolvedValue(null);

    await expect(
      service.resetPassword('c'.repeat(64), 'nova-senha-123'),
    ).rejects.toThrow(/inválido/);
  });

  it('confirma o e-mail de quem redefiniu sem ter confirmado antes', async () => {
    const token = 'd'.repeat(64);
    usersMock.findOneBy.mockResolvedValue(
      user({
        emailConfirmedAt: null as unknown as Date,
        passwordHash: await hash('antiga', 10),
        resetTokenHash: createHash('sha256').update(token).digest('hex'),
        resetTokenExpiresAt: new Date(Date.now() + 60_000),
      }),
    );

    await service.resetPassword(token, 'nova-senha-123');

    expect(stored?.emailConfirmedAt).toBeInstanceOf(Date);
  });
});
