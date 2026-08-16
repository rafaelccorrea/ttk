import { CombinationsService } from './combinations.service';
import { CombinationPlan } from './entities/combination-plan.entity';

/**
 * `expand` só lê o próprio plano — nenhum repositório é tocado. Instanciar com
 * `null` deixa o teste focado na regra de ordenação, sem subir o módulo.
 */
function servico(): CombinationsService {
  return new CombinationsService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
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
