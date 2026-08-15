import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { StoreImport } from './entities/store-import.entity';
import { StoreOrder } from './entities/store-order.entity';
import { StoreProduct } from './entities/store-product.entity';
import { Store } from './entities/store.entity';
import { StoresService } from './stores.service';

type Mocked<T> = { [K in keyof T]?: jest.Mock };

const store = (overrides: Partial<Store> = {}): Store =>
  ({
    id: 'store-1',
    userId: 'user-1',
    name: 'Loja Teste',
    marketplace: 'tiktok_shop',
    source: 'csv',
    externalShopId: null,
    currency: 'BRL',
    dateOrder: 'dmy',
    commissionPct: '8',
    taxPct: '6',
    ...overrides,
  }) as Store;

/** QueryBuilder encadeável: todo método devolve ele mesmo, menos os terminais. */
function queryBuilder(result: unknown) {
  const qb: Record<string, jest.Mock> = {};
  const chain = [
    'where',
    'andWhere',
    'leftJoinAndSelect',
    'innerJoin',
    'leftJoin',
    'select',
    'addSelect',
    'orderBy',
    'addOrderBy',
    'groupBy',
    'skip',
    'take',
    'setParameter',
  ];
  for (const method of chain) qb[method] = jest.fn(() => qb);
  qb.getManyAndCount = jest.fn(async () => result);
  qb.getRawMany = jest.fn(async () => result);
  qb.getRawOne = jest.fn(async () => result);
  return qb;
}

describe('StoresService', () => {
  let stores: Mocked<Repository<Store>>;
  let products: Mocked<Repository<StoreProduct>>;
  let orders: Mocked<Repository<StoreOrder>>;
  let imports: Mocked<Repository<StoreImport>>;
  let service: StoresService;

  beforeEach(() => {
    stores = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (entity) => entity),
      find: jest.fn(async () => []),
      findOneBy: jest.fn(async () => store()),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    products = {
      createQueryBuilder: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(async (entity) => entity),
    };
    orders = { createQueryBuilder: jest.fn() };
    imports = { find: jest.fn(async () => []) };

    service = new StoresService(
      stores as unknown as Repository<Store>,
      products as unknown as Repository<StoreProduct>,
      orders as unknown as Repository<StoreOrder>,
      imports as unknown as Repository<StoreImport>,
    );
  });

  // A checagem de posse é o limite de segurança do módulo inteiro: todo
  // endpoint passa por ela antes de tocar em qualquer dado.
  describe('owned', () => {
    it('busca a loja filtrando pelo usuário do token', async () => {
      await service.owned('user-1', 'store-1');
      expect(stores.findOneBy).toHaveBeenCalledWith({
        id: 'store-1',
        userId: 'user-1',
      });
    });

    it('rejeita loja de outro usuário como inexistente', async () => {
      stores.findOneBy!.mockResolvedValue(null);
      await expect(service.owned('intruso', 'store-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('aplica os padrões de marketplace, moeda e fonte', async () => {
      await service.create('user-1', { name: 'Minha Loja' });
      expect(stores.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          name: 'Minha Loja',
          marketplace: 'tiktok_shop',
          currency: 'BRL',
          dateOrder: 'dmy',
          source: 'csv',
          commissionPct: '0',
          taxPct: '0',
        }),
      );
    });

    it('preserva os percentuais informados', async () => {
      await service.create('user-1', {
        name: 'Loja',
        commissionPct: 8.5,
        taxPct: 6,
      });
      expect(stores.create).toHaveBeenCalledWith(
        expect.objectContaining({ commissionPct: '8.5', taxPct: '6' }),
      );
    });
  });

  describe('update', () => {
    it('altera só os campos enviados', async () => {
      const saved = await service.update('user-1', 'store-1', {
        commissionPct: 12,
      });
      expect(saved.commissionPct).toBe('12');
      expect(saved.name).toBe('Loja Teste');
      expect(saved.taxPct).toBe('6');
    });

    it('aceita zero como valor válido', async () => {
      const saved = await service.update('user-1', 'store-1', { taxPct: 0 });
      expect(saved.taxPct).toBe('0');
    });
  });

  describe('updateProduct', () => {
    const product = (overrides: Partial<StoreProduct> = {}) =>
      ({
        id: 'prod-1',
        storeId: 'store-1',
        sku: 'SKU-A',
        title: 'Camiseta',
        price: '100',
        cost: null,
        stock: 10,
        stockAlert: null,
        category: null,
        status: null,
        imageUrl: null,
        externalId: null,
        ...overrides,
      }) as StoreProduct;

    it('calcula lucro e margem descontando comissão e imposto da loja', async () => {
      products.findOneBy!.mockResolvedValue(product());

      const row = await service.updateProduct('user-1', 'store-1', 'prod-1', {
        cost: 40,
      });

      // 100 * (1 - 0,14) - 40 = 46
      expect(row.netProfit).toBe(46);
      expect(row.marginPct).toBe(46);
    });

    it('deixa margem nula enquanto não houver custo', async () => {
      products.findOneBy!.mockResolvedValue(product());

      const row = await service.updateProduct('user-1', 'store-1', 'prod-1', {
        stockAlert: 5,
      });

      expect(row.netProfit).toBeNull();
      expect(row.marginPct).toBeNull();
    });

    it('marca ruptura quando o estoque atinge o alerta', async () => {
      products.findOneBy!.mockResolvedValue(product({ stock: 3 }));

      const row = await service.updateProduct('user-1', 'store-1', 'prod-1', {
        stockAlert: 3,
      });

      expect(row.lowStock).toBe(true);
    });

    it('reporta margem negativa quando o custo supera o preço', async () => {
      products.findOneBy!.mockResolvedValue(product({ price: '50' }));

      const row = await service.updateProduct('user-1', 'store-1', 'prod-1', {
        cost: 60,
      });

      // 50 * 0,86 - 60 = -17
      expect(row.netProfit).toBe(-17);
      expect(row.marginPct).toBe(-34);
    });

    it('recusa produto que não é da loja', async () => {
      products.findOneBy!.mockResolvedValue(null);
      await expect(
        service.updateProduct('user-1', 'store-1', 'prod-x', { cost: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listOrders', () => {
    const order = (overrides: Partial<StoreOrder> = {}) =>
      ({
        id: 'o1',
        externalId: '5001',
        placedAt: new Date('2024-05-01T10:00:00Z'),
        status: 'Awaiting Shipment',
        stage: 'pendente',
        shipBy: null,
        shippedAt: null,
        shippingProvider: null,
        trackingCode: null,
        grossAmount: '89.80',
        shippingFee: '0',
        discount: '0',
        items: [],
        ...overrides,
      }) as StoreOrder;

    it('marca como atrasado o pedido pendente com prazo vencido', async () => {
      const past = new Date(Date.now() - 86_400_000);
      orders.createQueryBuilder!.mockReturnValue(
        queryBuilder([[order({ shipBy: past })], 1]),
      );

      const { items } = await service.listOrders('user-1', 'store-1', {});
      expect(items[0].late).toBe(true);
    });

    it('não marca atraso quando o prazo ainda não venceu', async () => {
      const future = new Date(Date.now() + 86_400_000);
      orders.createQueryBuilder!.mockReturnValue(
        queryBuilder([[order({ shipBy: future })], 1]),
      );

      const { items } = await service.listOrders('user-1', 'store-1', {});
      expect(items[0].late).toBe(false);
    });

    it('não marca atraso em pedido que já saiu, mesmo com prazo vencido', async () => {
      const past = new Date(Date.now() - 86_400_000);
      orders.createQueryBuilder!.mockReturnValue(
        queryBuilder([[order({ stage: 'enviado', shipBy: past })], 1]),
      );

      const { items } = await service.listOrders('user-1', 'store-1', {});
      expect(items[0].late).toBe(false);
    });

    it('converte os decimais do banco em número', async () => {
      orders.createQueryBuilder!.mockReturnValue(
        queryBuilder([
          [
            order({
              grossAmount: '89.80',
              items: [
                {
                  sku: 'SKU-A',
                  title: 'Camiseta',
                  quantity: 2,
                  unitPrice: '39.90',
                  subtotal: '79.80',
                },
              ] as StoreOrder['items'],
            }),
          ],
          1,
        ]),
      );

      const { items } = await service.listOrders('user-1', 'store-1', {});
      expect(items[0].grossAmount).toBe(89.8);
      expect(items[0].items[0].subtotal).toBe(79.8);
      expect(items[0].items[0].unitPrice).toBe(39.9);
    });
  });

  describe('simulatePricing', () => {
    it('usa comissão e imposto da loja quando não vierem no payload', async () => {
      const result = await service.simulatePricing('user-1', 'store-1', {
        cost: 40,
        price: 100,
      });
      // Comissão 8% + imposto 6% cadastrados na loja.
      expect(result.commissionAmount).toBe(8);
      expect(result.taxAmount).toBe(6);
      expect(result.netProfit).toBe(46);
    });

    it('deixa o payload sobrescrever os percentuais da loja', async () => {
      const result = await service.simulatePricing('user-1', 'store-1', {
        cost: 40,
        price: 100,
        commissionPct: 20,
        taxPct: 0,
      });
      expect(result.commissionAmount).toBe(20);
      expect(result.taxAmount).toBe(0);
      expect(result.netProfit).toBe(40);
    });
  });
});
