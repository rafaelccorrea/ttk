import { ordenarPorPrioridade } from './live-reply.service';

/**
 * O cartão de pergunta do TikTok (`questionNew`) é o sinal mais explícito de
 * intenção de compra que o webcast entrega. Estes testes travam o contrato da
 * priorização: pergunta declarada passa na frente, e a ordem cronológica
 * DENTRO de cada grupo não é embaralhada.
 */
describe('live — priorização de perguntas declaradas', () => {
  const m = (id: string, isQuestion?: boolean) => ({ id, isQuestion });

  it('põe as perguntas declaradas na frente do lote', () => {
    const lote = [m('a'), m('b', true), m('c'), m('d', true)];
    expect(ordenarPorPrioridade(lote).map((x) => x.id)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
  });

  it('preserva a ordem cronológica dentro de cada grupo', () => {
    // Sort estável: quem chegou primeiro continua primeiro entre iguais.
    const lote = [m('1', true), m('2'), m('3', true), m('4')];
    expect(ordenarPorPrioridade(lote).map((x) => x.id)).toEqual([
      '1',
      '3',
      '2',
      '4',
    ]);
  });

  it('não muda um lote sem perguntas declaradas nem o lote original', () => {
    const lote = [m('a'), m('b'), m('c')];
    const saida = ordenarPorPrioridade(lote);
    expect(saida.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    // Devolve cópia: o chamador pode manter o lote original intacto.
    expect(saida).not.toBe(lote);
  });
});
