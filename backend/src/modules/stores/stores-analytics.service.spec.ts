import { Repository } from 'typeorm';
import { ProductsService } from '../products/products.service';
import { StoreOrder } from './entities/store-order.entity';
import { StoreProduct } from './entities/store-product.entity';
import { StoreSettlement } from './entities/store-settlement.entity';
import { Store } from './entities/store.entity';
import { StoresAnalyticsService } from './stores-analytics.service';
import { StoresService } from './stores.service';

const trending = (title: string, id = title) => ({
  id,
  title,
  category: 'Moda',
  salesPeriod: 500,
  growthPct: 40,
  imageUrl: null,
  storeName: null,
  price: 0,
  rating: null,
  radarScore: null,
  tiktokUrl: null,
  revenuePeriod: 0,
});

describe('StoresAnalyticsService.opportunities', () => {
  let service: StoresAnalyticsService;
  let productsService: { rank: jest.Mock };
  let storeProducts: { find: jest.Mock };

  beforeEach(() => {
    productsService = { rank: jest.fn() };
    storeProducts = { find: jest.fn(async () => []) };

    const storesService = {
      owned: jest.fn(async () => ({ id: 'store-1' }) as Store),
    };

    service = new StoresAnalyticsService(
      storesService as unknown as StoresService,
      productsService as unknown as ProductsService,
      {} as Repository<StoreOrder>,
      storeProducts as unknown as Repository<StoreProduct>,
      {} as Repository<StoreSettlement>,
    );
  });

  it('reconhece o produto em alta que a loja já vende, apesar do título diferente', async () => {
    productsService.rank.mockResolvedValue({
      items: [trending('Camiseta Oversized Streetwear Masculina')],
    });
    storeProducts.find.mockResolvedValue([
      { sku: 'SKU-A', title: 'Camiseta Oversized Preta' },
    ]);

    const result = await service.opportunities('user-1', 'store-1');

    expect(result.selling).toHaveLength(1);
    expect(result.selling[0].sku).toBe('SKU-A');
    expect(result.missing).toHaveLength(0);
  });

  it('aponta como oportunidade o que não existe no catálogo', async () => {
    productsService.rank.mockResolvedValue({
      items: [trending('Mini Ventilador Portátil USB')],
    });
    storeProducts.find.mockResolvedValue([
      { sku: 'SKU-A', title: 'Camiseta Oversized Preta' },
    ]);

    const result = await service.opportunities('user-1', 'store-1');

    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].title).toBe('Mini Ventilador Portátil USB');
    expect(result.selling).toHaveLength(0);
  });

  it('ignora palavras vazias e acentos ao comparar títulos', async () => {
    productsService.rank.mockResolvedValue({
      items: [trending('Kit de Escova Alisadora com Íon')],
    });
    storeProducts.find.mockResolvedValue([
      { sku: 'SKU-B', title: 'Escova Alisadora Ion Profissional' },
    ]);

    const result = await service.opportunities('user-1', 'store-1');
    expect(result.selling).toHaveLength(1);
  });

  it('não casa produtos que só compartilham uma palavra genérica', async () => {
    productsService.rank.mockResolvedValue({
      items: [trending('Fone de Ouvido Bluetooth Esportivo')],
    });
    storeProducts.find.mockResolvedValue([
      { sku: 'SKU-C', title: 'Caixa de Som Bluetooth Portátil Grande' },
    ]);

    const result = await service.opportunities('user-1', 'store-1');
    expect(result.selling).toHaveLength(0);
    expect(result.missing).toHaveLength(1);
  });

  it('trata catálogo vazio como tudo sendo oportunidade', async () => {
    productsService.rank.mockResolvedValue({
      items: [trending('Produto A', 'a'), trending('Produto B', 'b')],
    });
    storeProducts.find.mockResolvedValue([]);

    const result = await service.opportunities('user-1', 'store-1');
    expect(result.missing).toHaveLength(2);
    expect(result.selling).toHaveLength(0);
  });

  it('limita a lista de oportunidades para não inundar a tela', async () => {
    productsService.rank.mockResolvedValue({
      items: Array.from({ length: 40 }, (_, i) =>
        trending(`Produto Distinto Numero ${i}`, `p${i}`),
      ),
    });
    storeProducts.find.mockResolvedValue([]);

    const result = await service.opportunities('user-1', 'store-1');
    expect(result.missing).toHaveLength(20);
  });
});
