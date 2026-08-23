import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MailService } from '../auth/mail.service';
import { NovaContaService } from './nova-conta.service';

describe('NovaContaService', () => {
  const send = jest.fn(() => Promise.resolve({}));
  const config = { get: jest.fn((_k: string, d?: unknown) => d) };
  let service: NovaContaService;
  const env = process.env.ADMIN_EMAILS;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        NovaContaService,
        { provide: MailService, useValue: { send } },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = m.get(NovaContaService);
    send.mockClear();
  });
  afterAll(() => {
    process.env.ADMIN_EMAILS = env;
  });

  const flush = () => new Promise((r) => setImmediate(r));

  it('manda um e-mail para cada admin com origem, fila e indicação', async () => {
    process.env.ADMIN_EMAILS = 'a@pikpok.test, B@pikpok.test';
    service.avisar({
      id: 'u1',
      email: 'novo@x.com',
      displayName: 'Novo',
      origem: 'google',
      naFila: true,
      indicadoPor: 'amigo@x.com',
    });
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    const [primeiro] = send.mock.calls[0] as unknown as [{ to: string; subject: string; text: string }];
    expect(primeiro.to).toBe('a@pikpok.test');
    expect(primeiro.subject).toContain('novo@x.com');
    expect(primeiro.subject).toContain('(na fila)');
    expect(primeiro.subject).toContain('Google');
    expect(primeiro.text).toContain('Indicado por: amigo@x.com');
    expect(primeiro.text).toContain('Nome: Novo');
  });

  it('sem ADMIN_EMAILS não envia nada', async () => {
    process.env.ADMIN_EMAILS = '';
    service.avisar({ id: 'u1', email: 'novo@x.com', origem: 'senha' });
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('falha no SMTP não estoura — vai para o log', async () => {
    process.env.ADMIN_EMAILS = 'a@pikpok.test';
    send.mockRejectedValueOnce(new Error('smtp fora'));
    expect(() => service.avisar({ id: 'u1', email: 'novo@x.com', origem: 'senha' })).not.toThrow();
    await flush();
  });
});
