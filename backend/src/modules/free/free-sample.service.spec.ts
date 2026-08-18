import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FREE_SAMPLE } from '../billing/billing.config';
import { Creator } from '../creators/entities/creator.entity';
import { ProductFavorite } from '../products/entities/product-favorite.entity';
import { Product } from '../products/entities/product.entity';
import { Video } from '../videos/entities/video.entity';
import { FreeSample } from './entities/free-sample.entity';
import { FreeSampleService } from './free-sample.service';

/**
 * Estes testes travam as invariantes do modo amostra (`docs/CONTA-FREE.md`).
 * Cada um existe contra um regresso específico — está anotado em cada `it`.
 */
describe('FreeSampleService', () => {
  let service: FreeSampleService;

  /** Banco de amostras em memória, com o UNIQUE de `slot` de verdade. */
  let salvos: FreeSample[];

  const produtoFalso = (i: number): Partial<Product> => ({
    id: `p${i}`,
    title: `Produto ${i}`,
    category: 'casa',
    imageUrl: 'http://img',
    price: '99.90' as any,
    sales30d: 25_317,
    sales60d: 40_000,
  });

  const videoFalso = (i: number): Partial<Video> => ({
    id: `v${i}`,
    caption: `Vídeo ${i}`,
    creatorHandle: '@alguem',
    category: 'casa',
    thumbnailUrl: null as any,
    views: 1_500_000,
    likes: 90_450,
    postedAt: '2026-08-01',
    videoUrl: 'http://tiktok/v',
    playbackUrl: 'http://cdn/should-never-leak.mp4',
    revenueEstimate: '12345.00',
    transcript: 'texto que não pode vazar',
  });

  const samplesRepo = {
    findOneBy: jest.fn(({ slot }: { slot: number }) =>
      Promise.resolve(salvos.find((s) => s.slot === slot) ?? null),
    ),
    create: jest.fn((dto) => dto),
    save: jest.fn((dto: FreeSample) => {
      if (salvos.some((s) => s.slot === dto.slot)) {
        return Promise.reject(new Error('duplicate key value: IDX_free_samples_slot'));
      }
      const gravado = { ...dto, id: `sample-${dto.slot}` } as FreeSample;
      salvos.push(gravado);
      return Promise.resolve(gravado);
    }),
  };

  const productsRepo = {
    query: jest.fn(() =>
      Promise.resolve(
        Array.from(
          { length: FREE_SAMPLE.products * FREE_SAMPLE.poolFactor },
          (_, i) => ({ id: `p${i}` }),
        ),
      ),
    ),
    find: jest.fn(({ where }: any) =>
      Promise.resolve(
        (where.id._value as string[]).map((id) =>
          produtoFalso(Number(id.slice(1))),
        ),
      ),
    ),
  };

  const videosRepo = {
    query: jest.fn(() =>
      Promise.resolve(
        Array.from(
          { length: FREE_SAMPLE.videos * FREE_SAMPLE.poolFactor },
          (_, i) => ({ id: `v${i}` }),
        ),
      ),
    ),
    find: jest.fn(({ where }: any) =>
      Promise.resolve(
        (where.id._value as string[]).map((id) => videoFalso(Number(id.slice(1)))),
      ),
    ),
  };

  const creatorsRepo = {
    query: jest.fn(() =>
      Promise.resolve(
        Array.from(
          { length: FREE_SAMPLE.creators * FREE_SAMPLE.poolFactor },
          (_, i) => ({ id: `c${i}` }),
        ),
      ),
    ),
    find: jest.fn(({ where }: any) =>
      Promise.resolve(
        (where.id._value as string[]).map((id) => ({
          id,
          handle: '@quem',
          name: 'Quem Vende',
          category: 'casa',
          avatarUrl: null,
          followers: 12_345,
          // Campos que NÃO podem vazar para a resposta reduzida:
          gmvPeriod: '99999.00',
          salesPeriod: 4321,
        })),
      ),
    ),
  };

  /** Favoritos em memória, com o mesmo comportamento de toggle do repositório. */
  let favoritados: Array<{ id: string; userId: string; productId: string }>;
  const favoritosRepo = {
    find: jest.fn(({ where }: any) =>
      Promise.resolve(favoritados.filter((f) => f.userId === where.userId)),
    ),
    findOneBy: jest.fn(({ userId, productId }: any) =>
      Promise.resolve(
        favoritados.find((f) => f.userId === userId && f.productId === productId) ??
          null,
      ),
    ),
    create: jest.fn((dto: any) => ({ ...dto, id: `fav-${dto.productId}` })),
    save: jest.fn((dto: any) => {
      favoritados.push(dto);
      return Promise.resolve(dto);
    }),
    delete: jest.fn(({ id }: any) => {
      favoritados = favoritados.filter((f) => f.id !== id);
      return Promise.resolve({ affected: 1 });
    }),
  };

  beforeEach(async () => {
    salvos = [];
    favoritados = [];
    const module = await Test.createTestingModule({
      providers: [
        FreeSampleService,
        { provide: getRepositoryToken(FreeSample), useValue: samplesRepo },
        { provide: getRepositoryToken(Product), useValue: productsRepo },
        { provide: getRepositoryToken(Video), useValue: videosRepo },
        { provide: getRepositoryToken(Creator), useValue: creatorsRepo },
        { provide: getRepositoryToken(ProductFavorite), useValue: favoritosRepo },
      ],
    }).compile();
    service = module.get(FreeSampleService);
    jest.clearAllMocks();
  });

  // Contra o F5 que revela item novo — a razão de a amostra ser congelada.
  it('devolve exatamente o mesmo conjunto em chamadas seguidas', async () => {
    const primeira = await service.snapshot();
    const segunda = await service.snapshot();
    expect(segunda.products.map((p) => p.id)).toEqual(
      primeira.products.map((p) => p.id),
    );
    expect(segunda.videos.map((v) => v.id)).toEqual(
      primeira.videos.map((v) => v.id),
    );
    // A segunda chamada leu o snapshot gravado em vez de escolher de novo.
    expect(productsRepo.query).toHaveBeenCalledTimes(1);
  });

  // Contra amostras diferentes na mesma semana (duas requisições simultâneas).
  it('duas gerações concorrentes convergem para o mesmo snapshot', async () => {
    const [a, b] = await Promise.all([
      service.currentSample(),
      service.currentSample(),
    ]);
    expect(a.productIds).toEqual(b.productIds);
    expect(salvos).toHaveLength(1);
  });

  // Contra o limite decorativo: sem isto, um id qualquer abre o detalhe.
  it('nega o detalhe de um id fora da amostra', async () => {
    await expect(service.produto('p999')).rejects.toThrow(ForbiddenException);
    await expect(service.video('v999')).rejects.toThrow(ForbiddenException);
  });

  it('entrega o detalhe de um id que está na amostra', async () => {
    const { products } = await service.snapshot();
    await expect(service.produto(products[0].id)).resolves.toMatchObject({
      id: products[0].id,
    });
  });

  // Contra o limite que cresce sem ninguém decidir.
  it('respeita as quantidades da configuração', async () => {
    const snap = await service.snapshot();
    expect(snap.products).toHaveLength(FREE_SAMPLE.products);
    expect(snap.videos).toHaveLength(FREE_SAMPLE.videos);
    expect(snap.creators).toHaveLength(FREE_SAMPLE.creators);
    expect(snap.limits).toEqual({
      products: FREE_SAMPLE.products,
      videos: FREE_SAMPLE.videos,
      creators: FREE_SAMPLE.creators,
      refreshDays: FREE_SAMPLE.refreshDays,
    });
  });

  // Contra o vazamento por omissão: o que se vende não pode sair daqui.
  it('não expõe dado acionável nem playback', async () => {
    const snap = await service.snapshot();
    const produto = snap.products[0] as unknown as Record<string, unknown>;
    for (const campo of ['storeName', 'tiktokUrl', 'revenuePeriod', 'sales30d']) {
      expect(produto).not.toHaveProperty(campo);
    }
    expect(produto.salesRange).toBe('25 mil+'); // faixa, nunca o exato

    const video = snap.videos[0] as unknown as Record<string, unknown>;
    for (const campo of ['playbackUrl', 'revenueEstimate', 'transcript']) {
      expect(video).not.toHaveProperty(campo);
    }
    // Milhão vira "mi+", não "1.500 mil+": a régua nasceu para vendas e
    // também serve visualizações, que são uma ordem de grandeza acima.
    expect(video.viewsRange).toBe('1 mi+');
  });

  // Contra o vazamento do que a tela de Criadores vende: quem fatura quanto.
  it('não expõe GMV nem vendas do criador', async () => {
    const { creators } = await service.snapshot();
    const criador = creators[0] as unknown as Record<string, unknown>;
    for (const campo of ['gmvPeriod', 'salesPeriod', 'followers']) {
      expect(criador).not.toHaveProperty(campo);
    }
    expect(criador.followersRange).toBe('12 mil+');
  });

  // Contra a lista de favoritos virar um jeito de acumular catálogo.
  it('favorita dentro da amostra e recusa fora dela', async () => {
    const { products } = await service.snapshot('u1');
    const alvo = products[0].id;

    await expect(service.alternarFavorito('u1', alvo)).resolves.toEqual({
      isFavorite: true,
    });
    await expect(service.listarFavoritos('u1')).resolves.toHaveLength(1);
    await expect(service.alternarFavorito('u1', alvo)).resolves.toEqual({
      isFavorite: false,
    });
    await expect(service.listarFavoritos('u1')).resolves.toHaveLength(0);

    // Um id fora da amostra não pode nem ser favoritado: o toggle confirmaria
    // que ele existe no catálogo.
    await expect(service.alternarFavorito('u1', 'p999')).rejects.toThrow(
      ForbiddenException,
    );
  });

  // Contra a amostra que congela para sempre.
  it('gera um snapshot novo quando a janela vira', async () => {
    const anterior = await service.currentSample();
    const real = Date.now;
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(real() + FREE_SAMPLE.refreshDays * 24 * 60 * 60 * 1000);
    const novo = await service.currentSample();
    expect(novo.slot).toBe(anterior.slot + 1);
    expect(novo.expiresAt.getTime()).toBeGreaterThan(
      anterior.expiresAt.getTime(),
    );
    jest.spyOn(Date, 'now').mockRestore();
  });

  // Contra o rodízio decorativo: a janela virava, mas a query devolvia o mesmo
  // topo de ranking e o usuário via a mesma vitrine na segunda seguinte.
  it('troca os itens de uma janela para a outra', async () => {
    const semana1 = await service.currentSample();
    const real = Date.now;
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(real() + FREE_SAMPLE.refreshDays * 24 * 60 * 60 * 1000);
    const semana2 = await service.currentSample();
    jest.spyOn(Date, 'now').mockRestore();

    expect(semana2.productIds).not.toEqual(semana1.productIds);
    expect(semana2.videoIds).not.toEqual(semana1.videoIds);
    expect(semana2.productIds).toHaveLength(FREE_SAMPLE.products);
    // Sem sobreposição enquanto o pool não dá a volta: uma semana inteira de
    // itens novos, não dois cards trocados.
    const repetidos = semana2.productIds.filter((id) =>
      semana1.productIds.includes(id),
    );
    expect(repetidos).toHaveLength(0);
  });

  // Contra a amostra voltar a virar na madrugada de quinta (época Unix).
  it('a janela vira na segunda-feira 00:00 de Brasília', async () => {
    const sample = await service.currentSample();
    const vence = sample.expiresAt;
    // 00:00 de Brasília é 03:00 UTC.
    expect(vence.getUTCHours()).toBe(3);
    expect(vence.getUTCMinutes()).toBe(0);
    // Segunda-feira no fuso local do vencimento: 03:00 UTC ainda é segunda.
    expect(vence.getUTCDay()).toBe(1);
    expect(vence.getTime()).toBeGreaterThan(Date.now());
  });

  // Contra o custo por visitante voltando pela porta dos fundos.
  it('não depende de fornecedor externo: só lê o que já está no banco', () => {
    // O serviço recebe repositórios e nada mais — se um dia alguém injetar o
    // ExternalDataProvider aqui, a conta gratuita volta a custar por visita.
    const deps = Reflect.getMetadata('design:paramtypes', FreeSampleService);
    expect(deps).toHaveLength(5);
  });
});
