import {
  detectarSeparador,
  lerCatalogo,
  lerCsv,
  lerLista,
  lerPreco,
  mapearCabecalho,
} from './csv';

/**
 * O arquivo que o cliente manda de verdade — não o que a gente gostaria.
 *
 * A regra que organiza estes testes: um erro de leitura aqui não aparece como
 * erro. Ele aparece como um produto na base com o preço de outro, e o copiloto
 * anunciando isso ao vivo com toda a confiança. Por isso o preço tem mais teste
 * que o resto somado.
 */

describe('detecção do separador', () => {
  it('escolhe o ponto e vírgula do Excel em português', () => {
    expect(detectarSeparador('nome;preco;frete')).toBe(';');
  });

  it('escolhe a vírgula quando é ela que separa', () => {
    expect(detectarSeparador('name,price,shipping')).toBe(',');
  });

  it('não se deixa enganar por vírgula dentro de aspas', () => {
    // O caso que quebra o `split`: o nome do produto tem vírgula, e o arquivo é
    // separado por ponto e vírgula.
    expect(detectarSeparador('"Kit Glow, 3 em 1";preco')).toBe(';');
  });

  it('cai na vírgula quando há uma coluna só', () => {
    expect(detectarSeparador('nome')).toBe(',');
  });
});

describe('leitura das células', () => {
  it('mantém inteiro o campo com o separador dentro das aspas', () => {
    const linhas = lerCsv('nome,preco\n"Kit Glow, 3 em 1",129,90');
    expect(linhas[1][0]).toBe('Kit Glow, 3 em 1');
  });

  it('entende aspas escapadas', () => {
    const linhas = lerCsv('nome\n"Camiseta ""Oversized"" preta"');
    expect(linhas[1][0]).toBe('Camiseta "Oversized" preta');
  });

  it('aceita quebra de linha dentro do campo', () => {
    const linhas = lerCsv('nome;frete\nKit;"Sudeste: 3 dias\nNordeste: 7 dias"');
    expect(linhas).toHaveLength(2);
    expect(linhas[1][1]).toContain('Nordeste');
  });

  it('engole o BOM do Excel em vez de colá-lo no primeiro cabeçalho', () => {
    // Sem isto, a coluna vira "﻿nome", não casa com nada, e o arquivo
    // inteiro é lido como se não tivesse nome de produto.
    const linhas = lerCsv('﻿nome;preco\nKit;10');
    expect(mapearCabecalho(linhas[0])[0]).toBe('name');
  });

  it('lida com CRLF do Windows', () => {
    const linhas = lerCsv('nome;preco\r\nKit;10\r\n');
    expect(linhas).toHaveLength(2);
    expect(linhas[1][1]).toBe('10');
  });

  it('descarta linha em branco no meio do arquivo', () => {
    expect(lerCsv('nome\nKit\n\n\nOutro')).toHaveLength(3);
  });
});

describe('mapeamento do cabeçalho', () => {
  it('casa nome de coluna com acento e maiúscula', () => {
    const mapa = mapearCabecalho(['Produto', 'Preço', 'Variações']);
    expect(mapa).toEqual({ 0: 'name', 1: 'priceBrl', 2: 'variants' });
  });

  it('não deixa a segunda coluna de preço sobrescrever a primeira', () => {
    const mapa = mapearCabecalho(['nome', 'preco', 'valor']);
    expect(mapa[1]).toBe('priceBrl');
    expect(mapa[2]).toBeUndefined();
  });

  it('ignora coluna que não conhece', () => {
    const mapa = mapearCabecalho(['nome', 'sku_interno']);
    expect(mapa[1]).toBeUndefined();
  });
});

describe('leitura de preço', () => {
  it('lê o formato do Excel em português', () => {
    expect(lerPreco('1.299,90')).toBe(1299.9);
    expect(lerPreco('129,90')).toBe(129.9);
  });

  it('lê o formato de exportação de sistema', () => {
    expect(lerPreco('1299.90')).toBe(1299.9);
    expect(lerPreco('129.9')).toBe(129.9);
  });

  it('não lê milhar como decimal', () => {
    /*
     * O erro caro. "1.299" num arquivo pt-BR é mil duzentos e noventa e nove;
     * lê-lo como 1,299 põe um produto de mil e trezentos reais valendo um e
     * trinta — e o copiloto anuncia esse valor ao vivo, para o chat inteiro.
     */
    expect(lerPreco('1.299')).toBe(1299);
    expect(lerPreco('12.500')).toBe(12500);
  });

  it('tira o R$ e o espaço', () => {
    expect(lerPreco('R$ 89,90')).toBe(89.9);
    expect(lerPreco(' 89,90 ')).toBe(89.9);
  });

  it('devolve nulo em vez de zero quando não há preço', () => {
    // Zero é um preço — significa "de graça". Célula vazia significa "não sei",
    // e as duas coisas não podem virar o mesmo valor na base.
    expect(lerPreco('')).toBeNull();
    expect(lerPreco('a combinar')).toBeNull();
    expect(lerPreco('   ')).toBeNull();
  });

  it('recusa negativo', () => {
    expect(lerPreco('-10,00')).toBeNull();
  });

  it('arredonda para centavos', () => {
    expect(lerPreco('10.999')).toBe(10999);
    expect(lerPreco('10,999')).toBe(11);
  });
});

describe('listas', () => {
  it('aceita os separadores que a gente encontra na prática', () => {
    expect(lerLista('P|M|G', 50)).toEqual(['P', 'M', 'G']);
    expect(lerLista('P, M, G', 50)).toEqual(['P', 'M', 'G']);
    expect(lerLista('azul/rosa', 50)).toEqual(['azul', 'rosa']);
  });

  it('respeita o teto', () => {
    expect(lerLista('a|b|c|d', 2)).toEqual(['a', 'b']);
  });
});

describe('catálogo inteiro', () => {
  it('importa o arquivo típico do Excel em português', () => {
    const csv = [
      'Nome;Preço;Variações;Frete',
      '"Kit Glow, 3 em 1";R$ 1.299,90;P|M|G;Grátis acima de R$ 199',
      'Sérum Vitamina C;89,90;;',
    ].join('\n');

    const { produtos, ignoradas } = lerCatalogo(csv, 100);
    expect(ignoradas).toHaveLength(0);
    expect(produtos).toHaveLength(2);
    expect(produtos[0]).toMatchObject({
      name: 'Kit Glow, 3 em 1',
      priceBrl: 1299.9,
      variants: ['P', 'M', 'G'],
      shippingInfo: 'Grátis acima de R$ 199',
    });
    expect(produtos[1].priceBrl).toBe(89.9);
    expect(produtos[1].variants).toEqual([]);
  });

  it('conta a linha ruim em vez de perder o arquivo inteiro', () => {
    // 300 itens com 3 linhas quebradas têm de importar 297 e CONTAR as três.
    // Abortar tudo obriga o vendedor a caçar o erro sem pista — e ele desiste.
    const csv = ['nome;preco', 'Kit;10,00', ';50,00', 'Outro;20,00'].join('\n');
    const { produtos, ignoradas } = lerCatalogo(csv, 100);
    expect(produtos.map((p) => p.name)).toEqual(['Kit', 'Outro']);
    expect(ignoradas).toEqual([{ linha: 3, motivo: 'Sem nome de produto.' }]);
  });

  it('aceita a lista sem cabeçalho digitada no bloco de notas', () => {
    const { produtos } = lerCatalogo('Kit Glow;129,90\nSérum;89,90', 100);
    expect(produtos).toHaveLength(2);
    expect(produtos[0]).toMatchObject({ name: 'Kit Glow', priceBrl: 129.9 });
  });

  it('para no limite e diz que parou', () => {
    // Silenciar o corte faria o vendedor acreditar que importou tudo — e
    // descobrir o que faltou só quando o copiloto não soubesse responder.
    const linhas = ['nome;preco'];
    for (let i = 0; i < 10; i++) linhas.push(`Produto ${i};10,00`);
    const { produtos, ignoradas } = lerCatalogo(linhas.join('\n'), 5);
    expect(produtos).toHaveLength(5);
    expect(ignoradas[0].motivo).toContain('Limite');
  });

  it('devolve vazio para arquivo vazio, sem explodir', () => {
    expect(lerCatalogo('', 100)).toEqual({ produtos: [], ignoradas: [] });
  });
});
