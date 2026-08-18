import { compararTopo, relatarTopo, LinhaDoTopo } from './top-diff';

const linha = (id: string, sales30d: number): LinhaDoTopo => ({
  id,
  title: `Produto ${id}`,
  sales30d,
});

/**
 * O comparativo existe para UM caso: o topo que não muda.
 *
 * Foi assim que um defeito de dias passou despercebido — a coleta crescia,
 * o relatório mostrava produtos e vídeos aumentando, e a tela do cliente estava
 * congelada porque a coluna que a ordena não era escrita por ninguém. Os testes
 * abaixo garantem que esse silêncio não volte.
 */
describe('compararTopo', () => {
  it('acusa topo idêntico', () => {
    const topo = [linha('a', 100), linha('b', 90)];
    const d = compararTopo(topo, [...topo]);
    expect(d.identico).toBe(true);
    expect(relatarTopo(d)[0]).toContain('IDÊNTICO');
  });

  /*
   * O caso mais traiçoeiro: as mesmas posições, com números novos. NÃO é
   * idêntico — a coleta chegou —, e tratar como idêntico dispararia alarme
   * falso todo dia em que o ranking fosse estável.
   */
  it('não chama de idêntico quando só os números mudaram', () => {
    const antes = [linha('a', 100), linha('b', 90)];
    const depois = [linha('a', 137), linha('b', 90)];
    const d = compararTopo(antes, depois);
    expect(d.identico).toBe(false);
    expect(d.numerosMudaram).toBe(1);
    expect(d.moveram).toHaveLength(0);
  });

  it('separa quem entrou de quem saiu', () => {
    const antes = [linha('a', 100), linha('b', 90)];
    const depois = [linha('a', 100), linha('c', 95)];
    const d = compararTopo(antes, depois);
    expect(d.entraram.map((l) => l.id)).toEqual(['c']);
    expect(d.sairam.map((l) => l.id)).toEqual(['b']);
    expect(d.identico).toBe(false);
  });

  it('registra troca de posição de quem ficou', () => {
    const antes = [linha('a', 100), linha('b', 90)];
    const depois = [linha('b', 190), linha('a', 100)];
    const d = compararTopo(antes, depois);
    expect(d.moveram).toEqual(
      expect.arrayContaining([
        { title: 'Produto b', de: 2, para: 1 },
        { title: 'Produto a', de: 1, para: 2 },
      ]),
    );
  });

  /*
   * Catálogo novo: tudo entrou, nada saiu. É o primeiro dia de vida do
   * comparativo e não pode ser lido como "sem mudança".
   */
  it('trata topo vazio antes como entrada de todos', () => {
    const d = compararTopo([], [linha('a', 10)]);
    expect(d.entraram).toHaveLength(1);
    expect(d.sairam).toHaveLength(0);
    expect(d.identico).toBe(false);
  });

  it('o relato lista quem entrou e quem saiu', () => {
    const d = compararTopo([linha('b', 90)], [linha('c', 95)]);
    const texto = relatarTopo(d).join('\n');
    expect(texto).toContain('+ Produto c');
    expect(texto).toContain('- Produto b');
  });
});
