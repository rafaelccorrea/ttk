import { describe, expect, it } from 'vitest';
import {
  assinaturaDoAviso,
  deveReportar,
  scriptDeDeteccao,
} from './warning-detector';
import {
  proximoIndice,
  RotadorDeProdutos,
  scriptDePin,
  tituloBate,
} from './product-pinner';

/**
 * Os scripts viajam como STRING para `executeJavaScript`, então o teste faz o
 * mesmo que a BrowserView: avalia a string contra um `document` dublê. É o que
 * garante que eles continuam autocontidos — um import ou closure acidental
 * quebra aqui antes de quebrar numa live.
 */
function executar(script: string, documento: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('document', `return ${script}`)(documento);
}

const elemento = (texto: string) => ({ textContent: texto });

function documentoCom(mapa: Record<string, unknown>) {
  return {
    querySelector: (s: string) => (mapa[s] as object | undefined) ?? null,
    querySelectorAll: (s: string) => (Array.isArray(mapa[s]) ? mapa[s] : []),
  };
}

describe('detector de aviso — script injetado', () => {
  it('encontra o banner pelo primeiro seletor que casa e trunca o texto', () => {
    const doc = documentoCom({
      '[data-e2e="violation-banner"]': elemento(
        `  Seu conteúdo\n pode   violar ${'x'.repeat(400)}`,
      ),
    });
    const r = executar(
      scriptDeDeteccao(['[data-e2e="live-warning-banner"]', '[data-e2e="violation-banner"]']),
      doc,
    ) as { encontrado: boolean; seletorUsado: string; textoResumo: string };
    expect(r.encontrado).toBe(true);
    expect(r.seletorUsado).toBe('[data-e2e="violation-banner"]');
    // Espaços colapsados e teto de 200: o resumo é para gente e para o banco.
    expect(r.textoResumo.startsWith('Seu conteúdo pode violar')).toBe(true);
    expect(r.textoResumo.length).toBeLessThanOrEqual(200);
  });

  it('não encontra nada quando a cascata inteira falha', () => {
    const r = executar(scriptDeDeteccao(['.nao-existe']), documentoCom({})) as {
      encontrado: boolean;
    };
    expect(r.encontrado).toBe(false);
  });

  it('pula seletor inválido em vez de derrubar a varredura', () => {
    const doc = {
      querySelector: (s: string) => {
        if (s === ':::quebrado') throw new Error('seletor inválido');
        return s === '.ok' ? elemento('aviso') : null;
      },
    };
    const r = executar(scriptDeDeteccao([':::quebrado', '.ok']), doc) as {
      encontrado: boolean;
    };
    expect(r.encontrado).toBe(true);
  });
});

describe('detector de aviso — debounce por assinatura', () => {
  it('reporta o aviso novo e cala no mesmo aviso', () => {
    const primeira = assinaturaDoAviso('.banner', 'aviso A');
    expect(deveReportar(null, primeira)).toBe(true);
    expect(deveReportar(primeira, primeira)).toBe(false);
    // Texto mudou = aviso novo, mesmo no mesmo seletor.
    expect(deveReportar(primeira, assinaturaDoAviso('.banner', 'aviso B'))).toBe(
      true,
    );
  });
});

describe('pin de produto', () => {
  it('casa título com acento, caixa e espaços diferentes', () => {
    expect(tituloBate('  Kit  ROSA — Promoção ', 'kit rosa')).toBe(true);
    expect(tituloBate('Kit Azul', 'kit rosa')).toBe(false);
    expect(tituloBate('qualquer', '')).toBe(false);
  });

  it('clica no pin do item cujo texto contém o título', () => {
    let clicado = false;
    const botao = {
      closest: () => elemento('Kit Rosa Promoção R$ 89,90'),
      parentElement: null,
      click: () => {
        clicado = true;
      },
    };
    const doc = {
      querySelector: (s: string) =>
        s === '[data-e2e="product-panel"]'
          ? { querySelectorAll: (q: string) => (q === '.pin' ? [botao] : []) }
          : null,
    };
    const r = executar(
      scriptDePin(['[data-e2e="product-panel"]'], ['.pin'], 'kit rosa'),
      doc,
    ) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(clicado).toBe(true);
  });

  it('aponta a etapa que falhou quando o painel não está aberto', () => {
    const doc = {
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const r = executar(scriptDePin(['.painel'], ['.pin'], 'kit rosa'), doc) as {
      ok: boolean;
      etapaFalhou: string;
    };
    expect(r.ok).toBe(false);
    expect(r.etapaFalhou).toBe('painel_produtos');
  });
});

describe('rotação automática de produto', () => {
  it('gira a fila circular e trata lista vazia', () => {
    expect(proximoIndice(-1, 3)).toBe(0);
    expect(proximoIndice(0, 3)).toBe(1);
    expect(proximoIndice(2, 3)).toBe(0);
    expect(proximoIndice(5, 0)).toBe(-1);
  });

  it('fixa o próximo só quando o intervalo venceu, e respeita o interruptor', async () => {
    const fixados: string[] = [];
    let ligada = true;
    const rotador = new RotadorDeProdutos({
      ativa: () => ligada,
      intervaloMs: () => 10 * 60_000,
      titulos: async () => ['A', 'B'],
      fixar: async (t) => {
        fixados.push(t);
        return { ok: true };
      },
    });
    const t0 = 1_000_000;
    await rotador.tick(t0); // acabou de "iniciar" (ultimaTroca=0 → gira já? não: iniciar() seta; aqui dirigimos na mão)
    // Primeiro tick com relógio dirigido: ultimaTroca começa em 0, então a
    // primeira batida gira — é o comportamento de quem ligou a rotação agora.
    expect(fixados).toEqual(['A']);
    await rotador.tick(t0 + 60_000); // 1 min depois: cedo demais
    expect(fixados).toEqual(['A']);
    await rotador.tick(t0 + 11 * 60_000); // intervalo venceu
    expect(fixados).toEqual(['A', 'B']);
    ligada = false;
    await rotador.tick(t0 + 30 * 60_000); // desligada: nada, e zera o atraso
    ligada = true;
    await rotador.tick(t0 + 31 * 60_000); // religou há 1 min: ainda não
    expect(fixados).toEqual(['A', 'B']);
  });

  it('para sozinho depois de três falhas seguidas, avisando o motivo', async () => {
    let motivo: string | null = null;
    const rotador = new RotadorDeProdutos({
      ativa: () => true,
      intervaloMs: () => 1_000,
      titulos: async () => ['A', 'B', 'C'],
      fixar: async () => ({ ok: false }),
      aoParar: (m) => {
        motivo = m;
      },
    });
    await rotador.tick(10_000);
    await rotador.tick(20_000);
    expect(motivo).toBeNull();
    await rotador.tick(30_000);
    expect(motivo).toContain('rotação automática foi pausada');
  });
});
