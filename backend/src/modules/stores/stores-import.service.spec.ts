import { DataSource, Repository } from 'typeorm';
import { StoreImport } from './entities/store-import.entity';
import { StoreOrderItem } from './entities/store-order-item.entity';
import { StoreOrder } from './entities/store-order.entity';
import { StoreProduct } from './entities/store-product.entity';
import { StoreSettlement } from './entities/store-settlement.entity';
import { Store } from './entities/store.entity';
import { StoresImportService } from './stores-import.service';
import { StoresService } from './stores.service';

const csv = (content: string) => ({
  buffer: Buffer.from(content, 'utf8'),
  originalName: 'relatorio.csv',
});

const PRODUCTS_CSV = [
  'Product ID,Product Name,Seller SKU,Category,Retail Price,Quantity,Status',
  'P1,Camiseta Oversized,SKU-A,Moda,"49,90",120,Ativo',
].join('\n');

const ORDERS_CSV = [
  'Order ID,Order Status,Created Time,Seller SKU,Product Name,Quantity,SKU Subtotal After Discount,Order Amount',
  '5001,Shipped,01/05/2024 10:00:00,SKU-A,Camiseta,2,"79,80","79,80"',
].join('\n');

describe('StoresImportService', () => {
  let service: StoresImportService;
  let repos: Record<string, any>;
  let savedImport: StoreImport | null;

  const store = {
    id: 'store-1',
    userId: 'user-1',
    dateOrder: 'dmy',
  } as Store;

  function repo(existing: any[] = []) {
    let sequence = 0;
    return {
      create: jest.fn((dto) => ({ ...dto })),
      find: jest.fn(async () => existing),
      // O serviço usa o id devolvido pelo save para vincular os itens.
      save: jest.fn(async (entity) =>
        Array.isArray(entity)
          ? entity
          : { id: entity.id ?? `generated-${(sequence += 1)}`, ...entity },
      ),
      delete: jest.fn(async () => ({ affected: 0 })),
    };
  }

  beforeEach(() => {
    savedImport = null;
    repos = {
      StoreProduct: repo(),
      StoreOrder: repo(),
      StoreOrderItem: repo(),
      StoreSettlement: repo(),
    };

    const dataSource = {
      getRepository: jest.fn((entity: any) => repos[entity.name]),
    } as unknown as DataSource;

    const imports = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (entity: StoreImport) => {
        savedImport = { ...entity, id: 'import-1' } as StoreImport;
        return savedImport;
      }),
    } as unknown as Repository<StoreImport>;

    const storesService = {
      owned: jest.fn(async () => store),
    } as unknown as StoresService;

    service = new StoresImportService(storesService, dataSource, imports);
  });

  describe('produtos', () => {
    it('cria o SKU que ainda não existe', async () => {
      const report = await service.import(
        'user-1',
        'store-1',
        'products',
        csv(PRODUCTS_CSV),
      );

      expect(report.created).toBe(1);
      expect(report.updated).toBe(0);
      expect(repos.StoreProduct.save).toHaveBeenCalled();
    });

    // O relatório do TikTok não traz custo. Se a reimportação zerasse o campo,
    // o usuário perderia todo o trabalho de cadastrar margem.
    it('não sobrescreve o custo informado pelo usuário ao reimportar', async () => {
      const existing = {
        id: 'p1',
        storeId: 'store-1',
        sku: 'SKU-A',
        title: 'Camiseta Oversized',
        price: '39.90',
        cost: '18.00',
        stockAlert: 5,
      };
      repos.StoreProduct = repo([existing]);

      const report = await service.import(
        'user-1',
        'store-1',
        'products',
        csv(PRODUCTS_CSV),
      );

      expect(report.updated).toBe(1);
      expect(report.created).toBe(0);

      const [saved] = repos.StoreProduct.save.mock.calls[0][0];
      expect(saved.cost).toBe('18.00');
      expect(saved.stockAlert).toBe(5);
      // O que vem do arquivo é atualizado normalmente.
      expect(saved.price).toBe('49.9');
      expect(saved.stock).toBe(120);
    });
  });

  describe('pedidos', () => {
    it('normaliza o status para um estágio comparável', async () => {
      await service.import('user-1', 'store-1', 'orders', csv(ORDERS_CSV));

      const saved = repos.StoreOrder.save.mock.calls[0][0];
      expect(saved.status).toBe('Shipped');
      expect(saved.stage).toBe('enviado');
    });

    it('troca os itens em vez de acumular quando o pedido é reimportado', async () => {
      await service.import('user-1', 'store-1', 'orders', csv(ORDERS_CSV));

      expect(repos.StoreOrderItem.delete).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: expect.anything() }),
      );
      expect(repos.StoreOrderItem.save).toHaveBeenCalled();
    });
  });

  describe('relatório da importação', () => {
    it('registra as linhas puladas com o motivo', async () => {
      // Sem Product ID e sem Seller SKU não há como identificar o produto.
      const withBad = PRODUCTS_CSV + '\n,Produto solto,,Moda,"1,00",1,Ativo';

      const report = await service.import(
        'user-1',
        'store-1',
        'products',
        csv(withBad),
      );

      expect(report.skipped).toBe(1);
      expect(report.issues[0].message).toContain('sem SKU');
      expect(report.rowsRead).toBe(2);
    });

    it('grava o histórico com o nome do arquivo e a fonte', async () => {
      await service.import('user-1', 'store-1', 'products', csv(PRODUCTS_CSV));

      expect(savedImport).toMatchObject({
        storeId: 'store-1',
        dataset: 'products',
        source: 'csv',
        fileName: 'relatorio.csv',
      });
    });
  });
});
