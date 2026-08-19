import { BadRequestException, ConflictException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

/**
 * O módulo de campanhas é o que mais cobra crédito por clique — e não tinha um
 * teste sequer. O que estas specs protegem, em uma frase: o piso de fotos vale
 * na criação, a foto repetida é recusada em vez de sumir em silêncio, a
 * rotação usa TODAS as fotos, o render-all não abandona cena por causa da
 * vizinha, e a moderação barra antes de qualquer cobrança.
 */

type Dict = Record<string, unknown>;

/** Dublê de Repository com só o que os fluxos testados tocam. */
function repo(overrides: Dict = {}) {
  return {
    findOneBy: jest.fn(async () => null),
    findOneByOrFail: jest.fn(async () => ({})),
    find: jest.fn(async () => []),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    delete: jest.fn(async () => ({ affected: 1 })),
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(),
    ...overrides,
  } as Dict;
}

function servico(deps: Partial<Record<string, Dict>> = {}) {
  const produtos = deps.produtos ?? repo();
  const personas = deps.personas ?? repo();
  const campanhas = deps.campanhas ?? repo();
  const cenas = deps.cenas ?? repo();
  const catalogo = deps.catalogo ?? repo();
  const videos = deps.videos ?? repo();
  const ai = deps.ai ?? { enabled: false, generateCampaign: jest.fn() };
  const billing = deps.billing ?? {
    withCharge: jest.fn(async (_u: string, _a: string, fn: () => unknown) => fn()),
  };
  const videogen = deps.videogen ?? {
    generate: jest.fn(),
    generateFromImage: jest.fn(async () => ({ id: 'media-1', status: 'queued' })),
    refresh: jest.fn(),
  };
  const mirror = deps.mirror ?? {
    putImage: jest.fn(async () => 'https://cdn/img.webp'),
    mirror: jest.fn(),
    putVideo: jest.fn(),
  };
  const assembly = deps.assembly ?? { enabled: false, juntar: jest.fn() };

  const service = new CampaignsService(
    produtos as never,
    personas as never,
    campanhas as never,
    cenas as never,
    catalogo as never,
    videos as never,
    ai as never,
    videogen as never,
    mirror as never,
    billing as never,
    assembly as never,
  );
  return { service, produtos, personas, campanhas, cenas, videogen, mirror, ai };
}

const FOTOS = ['https://cdn/a.webp', 'https://cdn/b.webp', 'https://cdn/c.webp'];

describe('criarCampanha', () => {
  it('recusa produto com menos de 3 fotos, antes de qualquer gasto', async () => {
    const { service, campanhas } = servico({
      produtos: repo({
        findOneBy: jest.fn(async () => ({ id: 'p1', images: ['https://cdn/a.webp'] })),
      }),
    });
    await expect(
      service.criarCampanha('u1', { userProductId: 'p1', personaId: 'pe1' } as never),
    ).rejects.toThrow(BadRequestException);
    expect((campanhas.save as jest.Mock)).not.toHaveBeenCalled();
  });

  it('cria com 3 fotos e persona existente', async () => {
    const { service } = servico({
      produtos: repo({
        findOneBy: jest.fn(async () => ({ id: 'p1', name: 'Batom', images: FOTOS })),
      }),
      personas: repo({ findOneBy: jest.fn(async () => ({ id: 'pe1' })) }),
    });
    const criada = (await service.criarCampanha('u1', {
      userProductId: 'p1',
      personaId: 'pe1',
    } as never)) as unknown as Dict;
    expect(criada.title).toBe('Batom');
  });
});

describe('adicionarFoto', () => {
  it('recusa a MESMA foto de novo em vez de aceitar em silêncio', async () => {
    // A chave no S3 é hash do conteúdo: reenviar devolve a mesma URL. O 200
    // silencioso fazia o vendedor clicar achando que o upload travou.
    const { service } = servico({
      produtos: repo({
        findOneBy: jest.fn(async () => ({ id: 'p1', images: ['https://cdn/img.webp'] })),
      }),
      mirror: { putImage: jest.fn(async () => 'https://cdn/img.webp') },
    });
    await expect(
      service.adicionarFoto('u1', 'p1', Buffer.from('x')),
    ).rejects.toThrow(ConflictException);
  });

  it('respeita o teto de 5 fotos', async () => {
    const { service } = servico({
      produtos: repo({
        findOneBy: jest.fn(async () => ({ id: 'p1', images: [1, 2, 3, 4, 5] })),
      }),
    });
    await expect(
      service.adicionarFoto('u1', 'p1', Buffer.from('x')),
    ).rejects.toThrow(ConflictException);
  });
});

describe('gerarRoteiro — rotação de fotos', () => {
  it('cenas de produto consecutivas usam fotos DIFERENTES', async () => {
    // O bug original: o índice da rotação era o de TODAS as cenas, então com
    // uma demo só a foto era sempre a mesma — o vendedor subia 5 e via 1.
    const gravadas: Dict[] = [];
    const { service } = servico({
      campanhas: repo({
        findOneBy: jest.fn(async () => ({ id: 'c1', userProductId: 'p1', personaId: 'pe1', durationSeconds: 15, creditsSpent: 0 })),
      }),
      produtos: repo({
        findOneBy: jest.fn(async () => ({ id: 'p1', name: 'Batom', images: FOTOS, sourceProductId: null, priceBrl: null })),
      }),
      personas: repo({ findOneBy: jest.fn(async () => ({ id: 'pe1', label: 'Ana' })) }),
      cenas: repo({
        save: jest.fn(async (lista: Dict[]) => {
          gravadas.push(...lista);
          return lista;
        }),
        find: jest.fn(async () => []),
      }),
      videos: repo({
        createQueryBuilder: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orWhere: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getRawMany: jest.fn(async () => []),
        })),
      }),
      ai: {
        enabled: false,
        generateCampaign: jest.fn(async () => ({
          content: 'md',
          model: 'test',
          cenas: [
            { fala: 'gancho', acaoVisual: 'a', mostraProduto: false },
            { fala: 'demo 1', acaoVisual: 'b', mostraProduto: true },
            { fala: 'demo 2', acaoVisual: 'c', mostraProduto: true },
          ],
        })),
      },
    });

    await service.gerarRoteiro('u1', 'c1');
    const demos = gravadas.filter((c) => c.tipo === 'produto');
    expect(demos).toHaveLength(2);
    expect(demos[0].baseImageUrl).toBe(FOTOS[0]);
    expect(demos[1].baseImageUrl).toBe(FOTOS[1]); // não repete a primeira
  });
});

describe('renderizarTudo — fila de renderização', () => {
  function base(cenasNoBanco: Dict[], falha: Set<string>) {
    const campanha: Dict = {
      id: 'c1',
      userProductId: 'p1',
      personaId: 'pe1',
      renderQueue: false,
    };
    const campanhas = repo({
      findOneBy: jest.fn(async () => campanha),
      update: jest.fn(async () => ({})),
    });
    const { service, ...deps } = servico({
      campanhas,
      cenas: repo({ find: jest.fn(async () => cenasNoBanco) }),
      produtos: repo({ findOneBy: jest.fn(async () => ({ id: 'p1', images: FOTOS })) }),
      personas: repo({
        findOneBy: jest.fn(async () => ({ id: 'pe1', status: 'pronta', seedImageUrl: 'https://cdn/seed.webp' })),
      }),
    });
    const espiao = jest
      .spyOn(service, 'renderizarCena')
      .mockImplementation(async (_u, id) => {
        if (falha.has(id)) throw new ConflictException('falhou');
        return { id } as never;
      });
    jest
      .spyOn(service, 'detalharCampanha')
      .mockResolvedValue({ id: 'c1' } as never);
    return { service, espiao, campanha, ...deps, campanhas };
  }

  it('dispara SÓ a primeira cena e liga a fila — o resto é do polling', async () => {
    const cenas = [
      { id: 's1', ordem: 1, tipo: 'produto', status: 'pendente' },
      { id: 's2', ordem: 2, tipo: 'produto', status: 'pendente' },
      { id: 's3', ordem: 3, tipo: 'produto', status: 'pendente' },
    ];
    const { service, espiao, campanha } = base(cenas, new Set());
    await service.renderizarTudo('u1', 'c1');
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(espiao).toHaveBeenCalledWith('u1', 's1');
    expect(campanha.renderQueue).toBe(true);
  });

  it('com cena já em voo, arma a fila sem disparar outra (uma por vez)', async () => {
    const cenas = [
      { id: 's1', ordem: 1, tipo: 'produto', status: 'renderizando' },
      { id: 's2', ordem: 2, tipo: 'produto', status: 'pendente' },
    ];
    const { service, espiao, campanha } = base(cenas, new Set());
    await service.renderizarTudo('u1', 'c1');
    expect(espiao).not.toHaveBeenCalled();
    expect(campanha.renderQueue).toBe(true);
  });

  it('cena falhada volta para a fila como pendente (o clique é o retry)', async () => {
    const cenas = [
      { id: 's1', ordem: 1, tipo: 'produto', status: 'falhou', error: 'x' },
    ];
    const { service, espiao } = base(cenas, new Set());
    await service.renderizarTudo('u1', 'c1');
    expect(cenas[0].status).toBe('pendente');
    expect(cenas[0].error).toBeNull();
    expect(espiao).toHaveBeenCalledWith('u1', 's1');
  });

  it('se a primeira nem dispara, a exceção sobe e a fila desliga', async () => {
    const cenas = [{ id: 's1', ordem: 1, tipo: 'produto', status: 'pendente' }];
    const { service, campanhas } = base(cenas, new Set(['s1']));
    await expect(service.renderizarTudo('u1', 'c1')).rejects.toThrow(
      ConflictException,
    );
    expect(campanhas.update as jest.Mock).toHaveBeenCalledWith('c1', {
      renderQueue: false,
    });
  });
});

describe('avancarFila (via atualizarCampanha)', () => {
  function base(cenasNoBanco: Dict[], opts: { falhaDisparo?: boolean } = {}) {
    const campanha: Dict = {
      id: 'c1',
      userProductId: 'p1',
      personaId: 'pe1',
      renderQueue: true,
      creditsSpent: 0,
      finalVideoUrl: 'https://cdn/final.mp4', // impede a montagem automática no teste
    };
    const cenasSalvas: Dict[] = [];
    const campanhas = repo({
      findOneBy: jest.fn(async () => campanha),
      update: jest.fn(async () => ({})),
    });
    const cenas = repo({
      find: jest.fn(async () => cenasNoBanco),
      save: jest.fn(async (c: Dict) => {
        cenasSalvas.push(c);
        return c;
      }),
    });
    const { service } = servico({ campanhas, cenas });
    const espiao = jest
      .spyOn(service, 'renderizarCena')
      .mockImplementation(async (_u, id) => {
        if (opts.falhaDisparo) throw new ConflictException('Saldo insuficiente.');
        return { id } as never;
      });
    jest
      .spyOn(service, 'detalharCampanha')
      .mockResolvedValue({ id: 'c1' } as never);
    return { service, espiao, campanhas, cenasSalvas };
  }

  it('sem cena em voo, dispara a PRÓXIMA pendente na ordem', async () => {
    const { service, espiao } = base([
      { id: 's1', ordem: 1, status: 'pronta' },
      { id: 's2', ordem: 2, status: 'pendente' },
      { id: 's3', ordem: 3, status: 'pendente' },
    ]);
    await service.atualizarCampanha('u1', 'c1');
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(espiao).toHaveBeenCalledWith('u1', 's2');
  });

  it('com cena em voo, NÃO dispara outra', async () => {
    const { service, espiao } = base([
      { id: 's1', ordem: 1, status: 'renderizando', generatedMediaId: null },
      { id: 's2', ordem: 2, status: 'pendente' },
    ]);
    await service.atualizarCampanha('u1', 'c1');
    expect(espiao).not.toHaveBeenCalled();
  });

  it('sem pendentes, desliga a fila', async () => {
    const { service, espiao, campanhas } = base([
      { id: 's1', ordem: 1, status: 'pronta' },
      { id: 's2', ordem: 2, status: 'falhou' }, // falhou NÃO é retentada sozinha
    ]);
    await service.atualizarCampanha('u1', 'c1');
    expect(espiao).not.toHaveBeenCalled();
    expect(campanhas.update as jest.Mock).toHaveBeenCalledWith('c1', {
      renderQueue: false,
    });
  });

  it('falha no disparo grava a causa na cena e desliga a fila', async () => {
    const { service, campanhas, cenasSalvas } = base(
      [{ id: 's1', ordem: 1, status: 'pendente' }],
      { falhaDisparo: true },
    );
    await service.atualizarCampanha('u1', 'c1');
    const cena = cenasSalvas.find((c) => c.id === 's1');
    expect(cena?.status).toBe('falhou');
    expect(String(cena?.error)).toContain('Saldo insuficiente');
    expect(campanhas.update as jest.Mock).toHaveBeenCalledWith('c1', {
      renderQueue: false,
    });
  });
});

describe('moderação nos pontos de entrada', () => {
  it('criarProduto recusa conteúdo proibido antes de tocar no banco', async () => {
    const { service, produtos } = servico();
    await expect(
      service.criarProduto('u1', { name: 'Kit maconha premium' } as never),
    ).rejects.toThrow(BadRequestException);
    expect((produtos.save as jest.Mock)).not.toHaveBeenCalled();
  });

  it('editarCena recusa fala proibida antes de salvar', async () => {
    const { service } = servico({
      cenas: repo({
        findOneBy: jest.fn(async () => ({ id: 's1', status: 'pendente', tipo: 'produto' })),
      }),
      campanhas: repo({
        find: jest.fn(async () => [{ id: 'c1' }]),
      }),
    });
    // cenaDoUsuario resolve via campanhas do usuário; dublamos o próprio método
    jest
      .spyOn(service as never as { cenaDoUsuario: (u: string, s: string) => unknown }, 'cenaDoUsuario')
      .mockResolvedValue({ id: 's1', status: 'pendente', tipo: 'produto' } as never);
    await expect(
      service.editarCena('u1', 's1', { fala: 'compre cocaína aqui' } as never),
    ).rejects.toThrow(BadRequestException);
  });
});
