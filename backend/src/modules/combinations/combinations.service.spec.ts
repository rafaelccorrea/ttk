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
});
