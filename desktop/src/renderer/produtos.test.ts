import { describe, expect, it } from 'vitest';
import { formatarPrecoBrl, iniciaisDe, normalizarBusca } from './produtos';

describe('iniciaisDe', () => {
  it('pega a primeira letra, em maiúscula, ignorando espaço', () => {
    expect(iniciaisDe('  kit rosa')).toBe('K');
    expect(iniciaisDe('Ébano')).toBe('É');
  });

  it('cai para "?" sem nome ou com símbolo na frente', () => {
    expect(iniciaisDe('')).toBe('?');
    expect(iniciaisDe('   ')).toBe('?');
    expect(iniciaisDe('*promo*')).toBe('?');
  });
});

describe('formatarPrecoBrl', () => {
  it('formata em reais com vírgula e milhar', () => {
    expect(formatarPrecoBrl(89.9)).toBe('R$ 89,90');
    expect(formatarPrecoBrl(1299)).toBe('R$ 1.299,00');
    expect(formatarPrecoBrl(0)).toBe('R$ 0,00');
  });

  it('diz "sem preço" quando não há valor', () => {
    expect(formatarPrecoBrl(null)).toBe('sem preço');
    expect(formatarPrecoBrl(undefined)).toBe('sem preço');
    expect(formatarPrecoBrl(Number.NaN)).toBe('sem preço');
  });
});

describe('normalizarBusca', () => {
  it('tira acento, caixa e espaço sobrando', () => {
    expect(normalizarBusca('  Crème  Hidratante ')).toBe('creme hidratante');
    expect(normalizarBusca('ÁGUA')).toBe('agua');
  });

  it('faz o trecho digitado bater no título', () => {
    expect(normalizarBusca('Kit Glow Rosé').includes(normalizarBusca('rose'))).toBe(true);
    expect(normalizarBusca('')).toBe('');
  });
});
