import { describe, expect, it } from 'vitest';
import { aproveitamento, latencia, quando } from './HistoricoDeLives';

describe('aproveitamento', () => {
  it('mostra travessão, e não 0%, quando não houve resposta', () => {
    /*
     * "Nenhuma resposta gerada" e "nenhuma das respostas prestou" são coisas
     * diferentes. Mostrar as duas como 0% acusa o copiloto de um fracasso que
     * não houve — e é o número que o vendedor vai olhar para decidir se
     * renova o plano.
     */
    expect(aproveitamento(null)).toBe('—');
  });

  it('arredonda para inteiro', () => {
    expect(aproveitamento(0)).toBe('0%');
    expect(aproveitamento(0.666)).toBe('67%');
    expect(aproveitamento(1)).toBe('100%');
  });
});

describe('latência', () => {
  it('não finge precisão que não interessa', () => {
    expect(latencia(430)).toBe('<1s');
    expect(latencia(2400)).toBe('2.4s');
    expect(latencia(14200)).toBe('14s');
  });

  it('mostra travessão sem medição', () => {
    expect(latencia(null)).toBe('—');
  });
});

describe('quando', () => {
  it('chama de "ontem" a live da noite passada vista de manhã', () => {
    // O caso que uma conta de 24h erra: uma live que terminou às 23h, aberta
    // às 8h do dia seguinte, tem 9h de diferença — e ainda assim é ontem.
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    ontem.setHours(23, 30, 0, 0);
    expect(quando(ontem.toISOString())).toMatch(/^ontem, /);
  });

  it('reconhece o mesmo dia', () => {
    const agora = new Date();
    agora.setHours(9, 0, 0, 0);
    expect(quando(agora.toISOString())).toMatch(/^hoje, /);
  });

  it('cai na data cheia para o que é mais antigo', () => {
    const antes = new Date();
    antes.setDate(antes.getDate() - 5);
    expect(quando(antes.toISOString())).toMatch(/^\d{2}\/\d{2} às /);
  });

  it('aguenta run que nunca começou', () => {
    expect(quando(null)).toBe('—');
  });
});
