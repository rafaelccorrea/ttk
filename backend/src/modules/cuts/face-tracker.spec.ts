import { preencher, suavizar } from './face-tracker.service';

describe('face-tracker — trilha', () => {
  it('quadros sem rosto herdam o vizinho mais próximo', () => {
    expect(preencher([null, 0.3, null, null, 0.7, null])).toEqual([0.3, 0.3, 0.3, 0.3, 0.7, 0.7]);
    expect(preencher([null, null])).toEqual([0.5, 0.5]);
  });

  it('suavizar ignora tremidas pequenas e acompanha mudanças reais', () => {
    const parado = suavizar([0.5, 0.51, 0.49, 0.5, 0.52, 0.5, 0.49]);
    expect(new Set(parado).size).toBe(1);
    const mudou = suavizar([0.2, 0.2, 0.2, 0.2, 0.8, 0.8, 0.8, 0.8, 0.8]);
    expect(mudou[0]).toBeCloseTo(0.2, 1);
    expect(mudou[mudou.length - 1]).toBeCloseTo(0.8, 1);
  });
});
