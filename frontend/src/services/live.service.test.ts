import {
  blocosDeTranscricao,
  estimarCreditos,
  PRECO_PADRAO,
  TRANSCRIBE_BLOCK_MINUTES,
  TRANSCRIBE_MAX_MINUTES,
} from './live.service';

/**
 * Estas funções produzem o número em créditos que a tela promete ANTES de o
 * upload começar — e é a partir dele que o vendedor decide enviar uma live de
 * quatro horas. Se a conta daqui divergir da do backend, ele autoriza um gasto e
 * recebe outro, o que é a pior forma de perder confiança num produto que cobra
 * por uso.
 *
 * A regra que os testes protegem: o aviso pode superestimar, NUNCA subestimar.
 */
describe('estimativa de créditos da live gravada', () => {
  it('cobra pelo menos um bloco, mesmo numa gravação de segundos', () => {
    expect(blocosDeTranscricao(0)).toBe(1);
    expect(blocosDeTranscricao(1)).toBe(1);
    expect(blocosDeTranscricao(30)).toBe(1);
  });

  it('arredonda para cima: bloco começado é bloco cobrado', () => {
    // O backend faz exatamente isto (transcribeBlocks). Divergir aqui é
    // prometer barato e cobrar caro.
    expect(blocosDeTranscricao(10 * 60)).toBe(1);
    expect(blocosDeTranscricao(10 * 60 + 1)).toBe(2);
    expect(blocosDeTranscricao(60 * 60)).toBe(6);
  });

  it('soma a taxa única da extração aos blocos de transcrição', () => {
    const uma = estimarCreditos(60 * 60);
    expect(uma.blocos).toBe(6);
    expect(uma.creditos).toBe(PRECO_PADRAO.transcribe * 6 + PRECO_PADRAO.live_extract);
    expect(uma.exato).toBe(true);
  });

  it('marca como inexato quando não conseguiu ler a duração', () => {
    // É o que faz a tela dizer "a partir de" em vez de anunciar um valor que
    // vai crescer depois. Sem esta distinção o aviso vira mentira involuntária.
    const semDuracao = estimarCreditos(null);
    expect(semDuracao.exato).toBe(false);
    expect(semDuracao.blocos).toBe(1);

    const duracaoZero = estimarCreditos(0);
    expect(duracaoZero.exato).toBe(false);
  });

  it('usa os preços da carteira quando eles chegam, não os de tabela', () => {
    // Os preços mudam no backend; o front não pode ficar preso a uma cópia.
    const comPrecoNovo = estimarCreditos(20 * 60, { transcribe: 9, live_extract: 25 });
    expect(comPrecoNovo.creditos).toBe(9 * 2 + 25);
  });

  it('nunca estima menos do que o mínimo cobrável', () => {
    for (const segundos of [0, 1, 59, 60, 599, 600, 601, 3600, 14400]) {
      const { creditos, blocos } = estimarCreditos(segundos);
      expect(blocos).toBeGreaterThanOrEqual(1);
      expect(creditos).toBeGreaterThanOrEqual(
        PRECO_PADRAO.transcribe + PRECO_PADRAO.live_extract,
      );
    }
  });

  it('estima a live mais longa aceita sem explodir', () => {
    // O teto do pipeline são 5 horas: a tela precisa saber dizer o preço da
    // maior live que o backend aceita, senão o aviso falha justamente no caso
    // mais caro.
    const noTeto = estimarCreditos(TRANSCRIBE_MAX_MINUTES * 60);
    expect(noTeto.blocos).toBe(TRANSCRIBE_MAX_MINUTES / TRANSCRIBE_BLOCK_MINUTES);
    expect(Number.isFinite(noTeto.creditos)).toBe(true);
  });
});
