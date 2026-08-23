import { LIVE_MIN_MINUTES } from '../billing/billing.config';
import { dentroDoBlocoMinimo, excedeuDuracao } from './live-reply.service';

/**
 * O relógio de duração da run é `minutesCharged`, e estas duas funções são as
 * únicas decisões puras em cima dele: quando o teto do plano encerra a live, e
 * quais batimentos ainda estão cobertos pelo bloco mínimo pago na abertura.
 */
describe('live — teto de duração', () => {
  it('encerra exatamente no minuto do teto, não antes', () => {
    // Pro: 6 horas. O minuto 359 ainda roda; o 360º batimento encontra o
    // contador cheio e encerra sem cobrar.
    expect(excedeuDuracao(359, 360)).toBe(false);
    expect(excedeuDuracao(360, 360)).toBe(true);
    expect(excedeuDuracao(361, 360)).toBe(true);
  });

  it('aplica o teto de 24h do Business', () => {
    expect(excedeuDuracao(1439, 1440)).toBe(false);
    expect(excedeuDuracao(1440, 1440)).toBe(true);
  });

  it('trata teto ausente ou inválido como sem limite, nunca como zero', () => {
    // Um dado ruim (teto 0 ou negativo) não pode virar live de zero minutos —
    // o pior caso aceitável é não limitar e deixar o saldo mandar.
    expect(excedeuDuracao(10_000, 0)).toBe(false);
    expect(excedeuDuracao(10_000, -1)).toBe(false);
  });
});

describe('live — bloco mínimo de cobrança', () => {
  it('cobre os primeiros batimentos com o bloco pago na abertura', () => {
    // A abertura debita LIVE_MIN_MINUTES de uma vez; os batimentos 1..N só
    // reservam o minuto (relógio), sem debitar de novo.
    expect(dentroDoBlocoMinimo(0)).toBe(true);
    expect(dentroDoBlocoMinimo(LIVE_MIN_MINUTES - 1)).toBe(true);
    expect(dentroDoBlocoMinimo(LIVE_MIN_MINUTES)).toBe(false);
    expect(dentroDoBlocoMinimo(LIVE_MIN_MINUTES + 1)).toBe(false);
  });

  it('respeita um bloco mínimo explícito', () => {
    expect(dentroDoBlocoMinimo(4, 5)).toBe(true);
    expect(dentroDoBlocoMinimo(5, 5)).toBe(false);
  });
});
