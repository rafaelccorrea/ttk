import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { MailService } from '../auth/mail.service';
import { AppUser } from '../users/entities/app-user.entity';
import { StoreOrder } from './entities/store-order.entity';
import { StoreProduct } from './entities/store-product.entity';
import { Store } from './entities/store.entity';
import { StoresAlertsService } from './stores-alerts.service';

const HOUR = 3_600_000;

const store = (overrides: Partial<Store> = {}) =>
  ({
    id: 'store-1',
    userId: 'user-1',
    name: 'Loja Teste',
    ...overrides,
  }) as Store;

const order = (overrides: Partial<StoreOrder> = {}) =>
  ({
    id: 'o1',
    storeId: 'store-1',
    externalId: '5001',
    stage: 'pendente',
    shipBy: null,
    ...overrides,
  }) as StoreOrder;

const product = (overrides: Partial<StoreProduct> = {}) =>
  ({
    id: 'p1',
    storeId: 'store-1',
    sku: 'SKU-A',
    title: 'Camiseta',
    stock: null,
    stockAlert: null,
    ...overrides,
  }) as StoreProduct;

describe('StoresAlertsService', () => {
  let mail: { send: jest.Mock };
  let stores: { find: jest.Mock };
  let orders: { find: jest.Mock };
  let products: { find: jest.Mock };
  let users: { findOneBy: jest.Mock };
  let config: { get: jest.Mock };
  let service: StoresAlertsService;

  beforeEach(() => {
    mail = { send: jest.fn(async () => ({})) };
    stores = { find: jest.fn(async () => [store()]) };
    orders = { find: jest.fn(async () => []) };
    products = { find: jest.fn(async () => []) };
    users = {
      findOneBy: jest.fn(async () => ({ email: 'seller@loja.com' }) as AppUser),
    };
    config = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };

    service = new StoresAlertsService(
      mail as unknown as MailService,
      config as unknown as ConfigService,
      stores as unknown as Repository<Store>,
      orders as unknown as Repository<StoreOrder>,
      products as unknown as Repository<StoreProduct>,
      users as unknown as Repository<AppUser>,
    );
  });

  describe('buildDigest', () => {
    it('não gera aviso quando não há nada a reportar', async () => {
      expect(await service.buildDigest(store())).toBeNull();
    });

    it('conta apenas pedidos pendentes com prazo já vencido', async () => {
      orders.find.mockResolvedValue([
        order({ externalId: 'ATRASADO', shipBy: new Date(Date.now() - HOUR) }),
        order({ externalId: 'NO-PRAZO', shipBy: new Date(Date.now() + HOUR) }),
        order({ externalId: 'SEM-PRAZO', shipBy: null }),
      ]);

      const digest = await service.buildDigest(store());

      expect(digest!.lateCount).toBe(1);
      expect(digest!.lateOrders[0].externalId).toBe('ATRASADO');
    });

    it('só considera ruptura quando o SKU tem alerta configurado', async () => {
      products.find.mockResolvedValue([
        product({ sku: 'COM-ALERTA', stock: 2, stockAlert: 5 }),
        product({ sku: 'SEM-ALERTA', stock: 0, stockAlert: null }),
        product({ sku: 'ACIMA', stock: 50, stockAlert: 5 }),
      ]);

      const digest = await service.buildDigest(store());

      expect(digest!.lowStockCount).toBe(1);
      expect(digest!.lowStock[0].sku).toBe('COM-ALERTA');
    });

    it('limita os exemplos mas preserva a contagem total', async () => {
      products.find.mockResolvedValue(
        Array.from({ length: 12 }, (_, i) =>
          product({ sku: `SKU-${i}`, stock: 0, stockAlert: 1 }),
        ),
      );

      const digest = await service.buildDigest(store());

      expect(digest!.lowStockCount).toBe(12);
      expect(digest!.lowStock).toHaveLength(5);
    });
  });

  describe('runDailyAlerts', () => {
    it('não envia nada quando as lojas estão em dia', async () => {
      const result = await service.runDailyAlerts();
      expect(mail.send).not.toHaveBeenCalled();
      expect(result).toEqual({ sent: 0, skipped: 1 });
    });

    it('envia o resumo para o dono da loja', async () => {
      orders.find.mockResolvedValue([
        order({ shipBy: new Date(Date.now() - HOUR) }),
      ]);

      const result = await service.runDailyAlerts();

      expect(result.sent).toBe(1);
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'seller@loja.com',
          subject: 'Loja Teste: 1 pedido atrasado',
        }),
      );
    });

    it('escapa HTML vindo da planilha do usuário', async () => {
      products.find.mockResolvedValue([
        product({
          title: '<img src=x onerror="alert(1)">',
          stock: 0,
          stockAlert: 1,
        }),
      ]);

      await service.runDailyAlerts();

      const { body } = mail.send.mock.calls[0][0];
      expect(body).not.toContain('<img src=x');
      expect(body).toContain('&lt;img src=x');
    });

    it('respeita o desligamento por configuração', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'STORE_ALERTS_ENABLED' ? 'false' : undefined,
      );

      const result = await service.runDailyAlerts();

      expect(mail.send).not.toHaveBeenCalled();
      expect(result).toEqual({ sent: 0, skipped: 0 });
    });

    it('pula a loja sem e-mail em vez de quebrar a rodada', async () => {
      orders.find.mockResolvedValue([
        order({ shipBy: new Date(Date.now() - HOUR) }),
      ]);
      users.findOneBy.mockResolvedValue(null);

      const result = await service.runDailyAlerts();

      expect(mail.send).not.toHaveBeenCalled();
      expect(result).toEqual({ sent: 0, skipped: 1 });
    });

    it('continua nas demais lojas quando uma falha', async () => {
      stores.find.mockResolvedValue([
        store({ id: 'store-1', name: 'Loja A' }),
        store({ id: 'store-2', name: 'Loja B' }),
      ]);
      orders.find.mockResolvedValue([
        order({ shipBy: new Date(Date.now() - HOUR) }),
      ]);
      mail.send
        .mockRejectedValueOnce(new Error('SMTP fora do ar'))
        .mockResolvedValueOnce({});

      const result = await service.runDailyAlerts();

      expect(result).toEqual({ sent: 1, skipped: 1 });
    });
  });
});
