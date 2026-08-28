import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { NovaContaService } from '../users/nova-conta.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';

describe('AuthService — lista de espera', () => {
  let service: AuthService;
  let saved: Partial<AppUser> | null;

  const usersMock: any = {
    findOneBy: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn((dto) => { saved = dto; return Promise.resolve(dto); }),
    count: jest.fn(() => Promise.resolve(7)),
    find: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn(() => Promise.resolve(42)),
    })),
  };
  const mailMock = { sendConfirmationEmail: jest.fn(() => Promise.resolve({})) };
  const novaContaMock = { avisar: jest.fn() };
  let waitlistOn = true;
  const config = { get: jest.fn((k: string, d?: unknown) =>
    k === 'WAITLIST_MODE' ? (waitlistOn ? 'true' : 'false') : d) };

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [AuthService,
        { provide: ConfigService, useValue: config },
        { provide: MailService, useValue: mailMock },
        { provide: getRepositoryToken(AppUser), useValue: usersMock },
        { provide: NovaContaService, useValue: novaContaMock },
        { provide: UsersService, useValue: { invalidar: jest.fn() } }],
    }).compile();
    service = m.get(AuthService); saved = null; waitlistOn = true; jest.clearAllMocks();
  });

  it('na fila: cria a conta, guarda o token e NAO envia e-mail', async () => {
    usersMock.findOneBy.mockResolvedValue(null);
    const r: any = await service.register('novo@pikpok.test', 'senha123');
    expect(r.message).toBe('Você entrou na lista de espera!');
    expect(r.waitlisted).toBe(true);
    expect(r.position).toBe(42);
    expect(mailMock.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(saved!.waitlistedAt).toBeInstanceOf(Date);
    expect(saved!.confirmationToken).toHaveLength(64);
    expect(saved!.confirmationSentAt).toBeUndefined();
    // A equipe é avisada da conta nova mesmo na fila — com o selo.
    expect(novaContaMock.avisar).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'novo@pikpok.test', origem: 'senha', naFila: true }),
    );
  });

  it('recadastro do mesmo e-mail nao reinicia a posicao', async () => {
    const antes = new Date('2026-08-01T00:00:00Z');
    usersMock.findOneBy.mockResolvedValue({ id: 'u1', email: 'a@b.c', waitlistedAt: antes });
    await service.register('a@b.c', 'outrasenha');
    expect(saved!.waitlistedAt).toBe(antes);
    // Recadastro não é conta nova: nada de avisar de novo.
    expect(novaContaMock.avisar).not.toHaveBeenCalled();
  });

  it('com o modo desligado volta a enviar o e-mail na hora', async () => {
    waitlistOn = false;
    usersMock.findOneBy.mockResolvedValue(null);
    const r: any = await service.register('normal@pikpok.test', 'senha123');
    expect(r.waitlisted).toBe(false);
    expect(mailMock.sendConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it('login na fila explica a espera em vez de pedir confirmacao', async () => {
    const { hash } = require('bcryptjs');
    usersMock.findOneBy.mockResolvedValue({
      id: 'u1', email: 'a@b.c', passwordHash: await hash('senha123', 10),
      waitlistedAt: new Date(), emailConfirmedAt: null,
    });
    await expect(service.login('a@b.c', 'senha123')).rejects.toThrow(/lista de espera/);
  });

  it('release envia, tira da fila e marca a liberacao', async () => {
    const fila = [
      { id: '1', email: 'a@x.com', waitlistedAt: new Date(1), confirmationToken: 'tok-a' },
      { id: '2', email: 'b@x.com', waitlistedAt: new Date(2), confirmationToken: 'tok-b' },
    ];
    usersMock.find.mockResolvedValue(fila);
    usersMock.count.mockResolvedValue(0);
    const r = await service.releaseWaitlist(2);
    expect(r.sent).toBe(2);
    expect(mailMock.sendConfirmationEmail).toHaveBeenCalledTimes(2);
    expect(fila[0].waitlistedAt).toBeNull();
    expect((fila[0] as any).waitlistReleasedAt).toBeInstanceOf(Date);
  });

  it('falha de envio mantem a pessoa na fila', async () => {
    const fila = [{ id: '1', email: 'a@x.com', waitlistedAt: new Date(1), confirmationToken: 't' }];
    usersMock.find.mockResolvedValue(fila);
    usersMock.count.mockResolvedValue(1);
    mailMock.sendConfirmationEmail.mockRejectedValueOnce(new Error('SMTP fora'));
    const r = await service.releaseWaitlist(1);
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(1);
    expect(fila[0].waitlistedAt).not.toBeNull();
  });
});
