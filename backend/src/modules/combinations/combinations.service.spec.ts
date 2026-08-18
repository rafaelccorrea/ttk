import { CombinationsService } from './combinations.service';
import { CombinationPlan } from './entities/combination-plan.entity';

/**
 * `expand` só lê o próprio plano — nenhuma dependência injetada é tocada.
 *
 * O construtor é ignorado de propósito: listar um `null` por dependência fazia
 * este teste quebrar toda vez que o serviço passava a injetar mais alguma
 * coisa, sem que a regra sob teste tivesse mudado.
 */
function servico(): CombinationsService {
  const SemDependencias =
    CombinationsService as unknown as new () => CombinationsService;
  return new SemDependencias();
}

function plano(partes: Partial<CombinationPlan>): CombinationPlan {
  return {
    id: 'p1',
    userId: 'u1',
    sigla: 'ASP',
    format: '9:16',
    hooks: [],
    bodies: [],
    ctas: [],
    hookClipIds: [],
    bodyClipIds: [],
    ctaClipIds: [],
    createdAt: new Date(),
    ...partes,
  } as CombinationPlan;
}

describe('CombinationsService.expand', () => {
  it('mantém a matriz completa Gancho × Corpo × CTA', () => {
    const combinacoes = servico().expand(
      plano({
        hooks: ['g1', 'g2', 'g3'],
        bodies: ['c1', 'c2'],
        ctas: ['a1', 'a2'],
      }),
    );

    expect(combinacoes).toHaveLength(12);
    expect(new Set(combinacoes.map((c) => c.code)).size).toBe(12);
  });

  it('numera a ordem de postagem de 1 até o total, sem buracos', () => {
    const combinacoes = servico().expand(
      plano({ hooks: ['g1', 'g2', 'g3'], bodies: ['c1', 'c2'], ctas: ['a1'] }),
    );

    expect(combinacoes.map((c) => c.postOrder)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('abre a fila com um vídeo de cada gancho, antes de repetir qualquer um', () => {
    const combinacoes = servico().expand(
      plano({ hooks: ['g1', 'g2', 'g3'], bodies: ['c1', 'c2'], ctas: ['a1'] }),
    );

    // Os três primeiros são justamente os três ganchos distintos: é o que
    // impede o vendedor de postar a mesma abertura duas vezes seguidas.
    const primeiros = combinacoes.slice(0, 3).map((c) => c.hook);
    expect(new Set(primeiros)).toEqual(new Set(['g1', 'g2', 'g3']));
    expect(combinacoes.slice(0, 3).every((c) => c.originality === 'original')).toBe(
      true,
    );
  });

  it('nunca põe dois vídeos com o mesmo gancho em sequência quando há alternativa', () => {
    const combinacoes = servico().expand(
      plano({ hooks: ['g1', 'g2', 'g3'], bodies: ['c1', 'c2'], ctas: ['a1', 'a2'] }),
    );

    // Só vale enquanto ainda existe gancho não usado na fila restante; depois
    // que os ganchos acabam a repetição é inevitável.
    const ganchosDistintos = 3;
    for (let i = 1; i < ganchosDistintos; i++) {
      expect(combinacoes[i].hook).not.toBe(combinacoes[i - 1].hook);
    }
  });

  it('etiqueta como "muito-parecido" só o que repete gancho E corpo', () => {
    const combinacoes = servico().expand(
      plano({ hooks: ['g1'], bodies: ['c1'], ctas: ['a1', 'a2', 'a3'] }),
    );

    // Um gancho e um corpo: do segundo vídeo em diante só o CTA muda.
    expect(combinacoes.map((c) => c.originality)).toEqual([
      'original',
      'muito-parecido',
      'muito-parecido',
    ]);
  });

  it('trata bloco desligado como um vazio, sem zerar a matriz nem inventar letra', () => {
    const combinacoes = servico().expand(
      plano({ hooks: ['g1', 'g2'], bodies: [], ctas: [] }),
    );

    expect(combinacoes).toHaveLength(2);
    expect(combinacoes.map((c) => c.code).sort()).toEqual(['G1', 'G2']);
  });

  it('é determinístico: o mesmo plano gera sempre a mesma ordem', () => {
    const entrada = plano({
      hooks: ['g1', 'g2', 'g3', 'g4'],
      bodies: ['c1', 'c2'],
      ctas: ['a1', 'a2'],
    });
    const primeira = servico().expand(entrada).map((c) => c.code);
    const segunda = servico().expand(entrada).map((c) => c.code);

    expect(segunda).toEqual(primeira);
  });
});

/**
 * O estorno das montagens interrompidas roda no boot, e boot acontece em toda
 * instância — num deploy rolling, duas ao mesmo tempo. Sem a marcação
 * condicional as duas devolveriam o crédito da MESMA linha, e numa matriz de
 * 150 vídeos isso é crédito nascendo do nada.
 */
describe('CombinationsService.onApplicationBootstrap', () => {
  function servicoComPresos(afetadas: number) {
    const presos = [
      { id: 'v1', userId: 'u1', code: 'A1', filename: 'a.mp4', status: 'pendente' },
    ];
    const videos = {
      find: jest.fn().mockResolvedValue(presos),
      update: jest.fn().mockResolvedValue({ affected: afetadas }),
    };
    const billing = { refund: jest.fn().mockResolvedValue(undefined) };
    const s = servico();
    (s as unknown as Record<string, unknown>).videos = videos;
    (s as unknown as Record<string, unknown>).billing = billing;
    return { s, videos, billing };
  }

  it('estorna a linha que este processo conseguiu marcar como falha', async () => {
    const { s, videos, billing } = servicoComPresos(1);
    await s.onApplicationBootstrap();
    expect(videos.update).toHaveBeenCalledTimes(1);
    expect(billing.refund).toHaveBeenCalledTimes(1);
  });

  it('não estorna quando outra instância já marcou a mesma linha', async () => {
    const { s, billing } = servicoComPresos(0);
    await s.onApplicationBootstrap();
    expect(billing.refund).not.toHaveBeenCalled();
  });
});

/**
 * O teto de duração existe para não gastar 150 créditos montando 150 vídeos em
 * cima de um clipe errado — então o que importa é ele barrar ANTES da cobrança.
 */
describe('CombinationsService.conferirDuracoes', () => {
  function conferir(clipes: Array<Record<string, unknown>>) {
    const s = servico();
    (s as unknown as Record<string, unknown>).clips = {
      find: jest.fn().mockResolvedValue(clipes),
    };
    const p = plano({ hookClipIds: ['c1'], hooks: ['gancho'] });
    return (
      s as unknown as { conferirDuracoes(p: CombinationPlan): Promise<void> }
    ).conferirDuracoes(p);
  }

  it('recusa a montagem quando o clipe passa do teto do bloco', async () => {
    await expect(
      // 12s num bloco de gancho cujo teto é 8s.
      conferir([{ id: 'c1', role: 'hook', label: 'g.mp4', durationMs: 12_000 }]),
    ).rejects.toThrow(/longos demais/i);
  });

  it('deixa passar o clipe fora do ideal mas dentro do teto', async () => {
    await expect(
      conferir([{ id: 'c1', role: 'hook', label: 'g.mp4', durationMs: 6_000 }]),
    ).resolves.toBeUndefined();
  });

  it('não bloqueia quando a duração não pôde ser medida', async () => {
    await expect(
      conferir([{ id: 'c1', role: 'hook', label: 'g.mp4', durationMs: 0 }]),
    ).resolves.toBeUndefined();
  });
});

/**
 * A atribuição por peça é o que justifica a feature inteira: sem ela, lançar
 * resultado só devolveria ao vendedor o número que ele mesmo digitou.
 */
describe('CombinationsService.insights', () => {
  function servicoComVideos(videos: Array<Record<string, unknown>>) {
    const s = servico();
    (s as unknown as Record<string, unknown>).plans = {
      findOneBy: jest.fn().mockResolvedValue(
        plano({ hooks: ['gancho A', 'gancho B'], bodies: ['corpo 1'], ctas: ['cta 1'] }),
      ),
    };
    (s as unknown as Record<string, unknown>).videos = {
      find: jest.fn().mockResolvedValue(videos),
      count: jest.fn().mockResolvedValue(videos.length),
    };
    return s;
  }

  it('isola o efeito do gancho pela média dos vídeos que o usam', async () => {
    const s = servicoComVideos([
      { code: 'G1C1A1', views: 1000, sales: null },
      { code: 'G2C1A1', views: 5000, sales: null },
    ]);

    const r = await s.insights('u1', 'p1');
    // G2 rendeu 5× mais: é ele que deve encabeçar o ranking, com o rótulo do
    // plano para o vendedor saber QUAL gancho gravar de novo.
    expect(r.blocos.hook[0].codigo).toBe('G2');
    expect(r.blocos.hook[0].rotulo).toBe('gancho B');
    expect(r.blocos.hook[0].mediaViews).toBe(5000);
    expect(r.blocos.hook[1].mediaViews).toBe(1000);
  });

  it('ignora vídeo sem resultado lançado em vez de contá-lo como zero', async () => {
    const s = servicoComVideos([
      { code: 'G1C1A1', views: 1000, sales: null },
      { code: 'G1C1A1', views: null, sales: null },
    ]);

    const r = await s.insights('u1', 'p1');
    expect(r.videosLancados).toBe(1);
    // Média 1000, não 500: o não-lançado não existe para a conta.
    expect(r.blocos.hook[0].mediaViews).toBe(1000);
  });

  it('põe a peça sem dado por último, e não como a pior', async () => {
    const s = servicoComVideos([
      { code: 'G1C1A1', views: null, sales: 3 },
      { code: 'G2C1A1', views: 10, sales: null },
    ]);

    const r = await s.insights('u1', 'p1');
    expect(r.blocos.hook[0].codigo).toBe('G2');
    expect(r.blocos.hook[1].mediaViews).toBeNull();
  });

  it('marca como dado fraco a peça com menos vídeos que o mínimo', async () => {
    const s = servicoComVideos([
      // G1 com um vídeo de sorte; G2 com três, que é o mínimo.
      { code: 'G1C1A1', views: 90_000, sales: null },
      { code: 'G2C1A1', views: 1000, sales: null },
      { code: 'G2C1A1', views: 1000, sales: null },
      { code: 'G2C1A1', views: 1000, sales: null },
    ]);

    const r = await s.insights('u1', 'p1');
    // Continua no topo — é a maior média —, mas etiquetado: esconder seria pior
    // que avisar, e tratar como veredito é o que a etiqueta impede.
    expect(r.blocos.hook[0].codigo).toBe('G1');
    expect(r.blocos.hook[0].dadoFraco).toBe(true);
    expect(r.blocos.hook[1].dadoFraco).toBe(false);
    expect(r.minimoConfiavel).toBe(3);
  });
});

/**
 * Lançar em massa é o que faz o `insights` deixar de ser um painel vazio: sem
 * isto, o dado que alimenta a análise dependia de 150 diálogos preenchidos à
 * mão.
 */
describe('CombinationsService.setResultsBulk', () => {
  function servicoComLinhas(linhas: Array<Record<string, unknown>>) {
    const s = servico();
    const videos = {
      find: jest.fn().mockResolvedValue(linhas),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
    };
    (s as unknown as Record<string, unknown>).videos = videos;
    return { s, videos };
  }

  it('lança vários vídeos com uma única ida ao banco', async () => {
    const { s, videos } = servicoComLinhas([
      { id: 'v1', views: null, sales: null, postUrl: null },
      { id: 'v2', views: null, sales: null, postUrl: null },
    ]);

    const salvos = await s.setResultsBulk('u1', [
      { id: 'v1', views: 1000 },
      { id: 'v2', views: 2000, sales: 3 },
    ]);

    expect(videos.find).toHaveBeenCalledTimes(1);
    expect(salvos).toHaveLength(2);
    expect(salvos[0].views).toBe(1000);
    expect(salvos[1].sales).toBe(3);
  });

  it('não toca no campo que não veio no item', async () => {
    const { s } = servicoComLinhas([
      { id: 'v1', views: 10, sales: 7, postUrl: null },
    ]);

    const [salvo] = await s.setResultsBulk('u1', [{ id: 'v1', views: 99 }]);
    // Mandar só `views` não pode apagar as vendas já lançadas.
    expect(salvo.views).toBe(99);
    expect(salvo.sales).toBe(7);
  });

  it('ignora id que não pertence ao usuário em vez de falhar a leva inteira', async () => {
    // O `find` filtrado por dono simplesmente não devolve a linha do intruso.
    const { s } = servicoComLinhas([{ id: 'v1', views: null, sales: null }]);

    const salvos = await s.setResultsBulk('u1', [
      { id: 'v1', views: 5 },
      { id: 'de-outro-usuario', views: 5 },
    ]);
    expect(salvos).toHaveLength(1);
  });
});

/**
 * Derivar é o que fecha o ciclo: sem isto o ranking termina num beco e o
 * vendedor remonta a matriz de memória.
 */
describe('CombinationsService.derive', () => {
  function servicoParaDerivar(
    insights: Record<string, unknown>,
    plan = plano({
      sigla: 'ASP',
      hooks: ['g1', 'g2', 'g3', 'g4'],
      bodies: ['c1'],
      ctas: [],
      hookClipIds: ['ch1', 'ch2', 'ch3', 'ch4'],
      bodyClipIds: ['cb1'],
      ctaClipIds: [],
    }),
  ) {
    const s = servico();
    (s as unknown as Record<string, unknown>).plans = {
      findOneBy: jest.fn().mockResolvedValue(plan),
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
    };
    // O ranking já é testado à parte; aqui o que está sob teste é a poda.
    s.insights = jest.fn().mockResolvedValue(insights) as never;
    return s;
  }

  const peca = (
    indice: number,
    codigo: string,
    mediaViews: number | null,
    dadoFraco = false,
  ) => ({ indice, codigo, rotulo: codigo, videos: 3, mediaViews, totalVendas: null, dadoFraco });

  it('leva adiante só a metade melhor e mantém a ordem de gravação', async () => {
    const s = servicoParaDerivar({
      blocos: {
        hook: [
          peca(3, 'G4', 9000),
          peca(1, 'G2', 5000),
          peca(0, 'G1', 900),
          peca(2, 'G3', 100),
        ],
        body: [],
        cta: [],
      },
    });

    const novo = await s.derive('u1', 'p1');
    // G4 e G2 vencem, mas entram na ordem original (G2 antes de G4) — é assim
    // que a tela numera as peças.
    expect(novo.hooks).toEqual(['g2', 'g4']);
    expect(novo.hookClipIds).toEqual(['ch2', 'ch4']);
    // Bloco sem ranking passa inteiro: não ter dado não é ser ruim.
    expect(novo.bodies).toEqual(['c1']);
    expect(novo.sigla).toBe('ASP2');
  });

  it('não elimina peça por dado fraco', async () => {
    const s = servicoParaDerivar({
      blocos: {
        hook: [
          peca(0, 'G1', 90_000, true),
          peca(1, 'G2', 5000),
          peca(2, 'G3', 4000),
          peca(3, 'G4', 100),
        ],
        body: [],
        cta: [],
      },
    });

    const novo = await s.derive('u1', 'p1');
    // Só G2, G3 e G4 disputam (G1 é palpite): metade para cima = 2 → G2 e G3.
    expect(novo.hooks).toEqual(['g2', 'g3']);
  });

  it('mantém o bloco inteiro quando não há duas peças com dado firme', async () => {
    const s = servicoParaDerivar({
      blocos: {
        hook: [peca(0, 'G1', 1000), peca(1, 'G2', null)],
        body: [],
        cta: [],
      },
    });

    const novo = await s.derive('u1', 'p1');
    expect(novo.hooks).toHaveLength(4);
  });

  it('numera a sigla derivada sem estourar o limite da coluna', async () => {
    const s = servicoParaDerivar(
      { blocos: { hook: [], body: [], cta: [] } },
      plano({ sigla: 'ASP2', hooks: ['g1'], hookClipIds: ['ch1'] }),
    );
    expect((await s.derive('u1', 'p1')).sigla).toBe('ASP3');

    const longo = servicoParaDerivar(
      { blocos: { hook: [], body: [], cta: [] } },
      plano({ sigla: 'ABCDEFGHIJ', hooks: ['g1'], hookClipIds: ['ch1'] }),
    );
    expect((await longo.derive('u1', 'p1')).sigla).toHaveLength(10);
  });
});
