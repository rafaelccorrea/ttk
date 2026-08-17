import {
  aplicarPrecos,
  clusterKeyDe,
  contemLinkOuMencao,
  contemPrecoLiteral,
  decidirResposta,
  ehAltoValor,
  ehListaNegra,
  ehPergunta,
  normalizarTexto,
  truncar,
} from './live-reply.service';

/*
 * O que é testado aqui é a lógica que roda ANTES e DEPOIS do modelo — a parte
 * determinística, que é justamente a que segura o custo e impede o preço
 * inventado. O Claude não é chamado em teste nenhum: a resposta do modelo entra
 * como dado de entrada, porque o que precisa estar certo é o que o motor faz
 * COM ela, não o que ela é.
 */

describe('normalizarTexto', () => {
  it('achata caixa, acento, emoji e pontuação na mesma frase', () => {
    expect(normalizarTexto('QUANTO CUSTA??? 😍')).toBe('quanto custa');
    expect(normalizarTexto('Qual o PREÇO do azul?')).toBe(
      'qual o preco do azul',
    );
  });

  it('colapsa espaços e devolve vazio para mensagem só de emoji', () => {
    expect(normalizarTexto('  tem   azul  ')).toBe('tem azul');
    expect(normalizarTexto('🔥🔥🔥')).toBe('');
  });

  it('aguenta entrada nula sem quebrar o lote inteiro', () => {
    expect(normalizarTexto(undefined as unknown as string)).toBe('');
  });
});

describe('clusterKeyDe', () => {
  it('dá a mesma chave para o que a normalização já igualou', () => {
    expect(clusterKeyDe(normalizarTexto('Quanto custa?!'))).toBe(
      clusterKeyDe(normalizarTexto('QUANTO CUSTA 😍')),
    );
  });

  it('dá chaves diferentes para perguntas diferentes', () => {
    expect(clusterKeyDe(normalizarTexto('quanto custa'))).not.toBe(
      clusterKeyDe(normalizarTexto('quanto custa o frete')),
    );
  });
});

describe('ehPergunta', () => {
  it('aceita interrogação explícita', () => {
    expect(ehPergunta('serve?')).toBe(true);
  });

  it('aceita pergunta sem interrogação, pela palavra interrogativa', () => {
    expect(ehPergunta('tem azul')).toBe(true);
    expect(ehPergunta('chega em quantos dias')).toBe(true);
    expect(ehPergunta('cabe em mim')).toBe(true);
  });

  it('descarta o ruído que domina o chat de live', () => {
    expect(ehPergunta('kkkk')).toBe(false);
    expect(ehPergunta('top')).toBe(false);
    expect(ehPergunta('❤️')).toBe(false);
    expect(ehPergunta('')).toBe(false);
  });
});

describe('classificação da pergunta', () => {
  it('reconhece as perguntas que decidem a compra', () => {
    expect(ehAltoValor(normalizarTexto('quanto custa o kit?'))).toBe(true);
    expect(ehAltoValor(normalizarTexto('tem em tamanho M?'))).toBe(true);
    expect(ehAltoValor(normalizarTexto('boa noite pessoal'))).toBe(false);
  });

  it('reconhece a lista negra', () => {
    expect(ehListaNegra(normalizarTexto('e a garantia?'))).toBe(true);
    expect(ehListaNegra(normalizarTexto('vem com nota fiscal'))).toBe(true);
    expect(ehListaNegra(normalizarTexto('qual o prazo de entrega'))).toBe(true);
    expect(ehListaNegra(normalizarTexto('tem azul'))).toBe(false);
  });
});

describe('decidirResposta', () => {
  const pergunta = normalizarTexto('quanto custa o azul');

  it('envia quando há confiança alta E fonte', () => {
    expect(
      decidirResposta({
        confianca: 0.91,
        sourceProductIds: ['p1'],
        perguntaNormalizada: pergunta,
      }),
    ).toBe('enviar');
  });

  it('escala na faixa do meio', () => {
    expect(
      decidirResposta({
        confianca: 0.6,
        sourceProductIds: ['p1'],
        perguntaNormalizada: pergunta,
      }),
    ).toBe('escalar');
  });

  it('silencia abaixo do piso', () => {
    expect(
      decidirResposta({
        confianca: 0.2,
        sourceProductIds: ['p1'],
        perguntaNormalizada: pergunta,
      }),
    ).toBe('silenciar');
  });

  it('respeita a fronteira exata de 0.80 e 0.55', () => {
    const base = { sourceProductIds: ['p1'], perguntaNormalizada: pergunta };
    expect(decidirResposta({ ...base, confianca: 0.8 })).toBe('enviar');
    expect(decidirResposta({ ...base, confianca: 0.79 })).toBe('escalar');
    expect(decidirResposta({ ...base, confianca: 0.55 })).toBe('escalar');
    expect(decidirResposta({ ...base, confianca: 0.54 })).toBe('silenciar');
  });

  // A âncora em fonte é o que impede a alucinação de preço, e por isso ela tem
  // teste próprio: alta confiança SEM produto é o retrato exato do modelo
  // inventando com segurança.
  it('escala confiança altíssima sem nenhuma fonte', () => {
    expect(
      decidirResposta({
        confianca: 0.99,
        sourceProductIds: [],
        perguntaNormalizada: pergunta,
      }),
    ).toBe('escalar');
  });

  it('escala assunto da lista negra mesmo com confiança e fonte', () => {
    expect(
      decidirResposta({
        confianca: 0.99,
        sourceProductIds: ['p1'],
        perguntaNormalizada: normalizarTexto('como funciona a garantia?'),
      }),
    ).toBe('escalar');
  });
});

describe('aplicarPrecos', () => {
  const precos = new Map<string, string | null>([
    ['abc', '49.90'],
    ['sem-preco', null],
  ]);

  it('troca o marcador pelo valor do banco', () => {
    const r = aplicarPrecos('Sai por {{PRECO:abc}} hoje', precos);
    expect(r.texto).toBe('Sai por R$ 49,90 hoje');
    expect(r.resolvido).toBe(true);
  });

  it('troca vários marcadores na mesma resposta', () => {
    const r = aplicarPrecos('{{PRECO:abc}} e {{PRECO:abc}}', precos);
    expect(r.texto).toBe('R$ 49,90 e R$ 49,90');
    expect(r.resolvido).toBe(true);
  });

  // O caso que a regra existe para pegar: id que não está na base. Deixar o
  // marcador de pé é intencional — quem chama transforma isso em escalação.
  it('não resolve id inexistente e sinaliza', () => {
    const r = aplicarPrecos('Custa {{PRECO:fantasma}}', precos);
    expect(r.resolvido).toBe(false);
    expect(r.texto).toContain('{{PRECO:fantasma}}');
  });

  it('não resolve produto sem preço cadastrado', () => {
    const r = aplicarPrecos('Custa {{PRECO:sem-preco}}', precos);
    expect(r.resolvido).toBe(false);
  });

  it('não mexe em resposta que não cita preço', () => {
    const r = aplicarPrecos('Temos em azul e preto', precos);
    expect(r.texto).toBe('Temos em azul e preto');
    expect(r.resolvido).toBe(true);
  });

  it('tolera espaço em volta do id', () => {
    expect(aplicarPrecos('{{PRECO: abc }}', precos).texto).toBe('R$ 49,90');
  });

  // O marcador MALFORMADO é o caso que passava batido: o regex não casa, nada é
  // substituído e a resposta saía "resolvida" com lixo de template no meio.
  it('não resolve marcador malformado', () => {
    expect(aplicarPrecos('Sai por {{PRECO:abc} viu', precos).resolvido).toBe(
      false,
    );
    expect(aplicarPrecos('Sai por {{PREÇO:abc}} viu', precos).resolvido).toBe(
      false,
    );
    expect(aplicarPrecos('Sai por {{PRECO abc}} viu', precos).resolvido).toBe(
      false,
    );
  });

  it('não confunde a resposta legítima com um marcador quebrado', () => {
    const r = aplicarPrecos('O preço do azul é {{PRECO:abc}}', precos);
    expect(r.texto).toBe('O preço do azul é R$ 49,90');
    expect(r.resolvido).toBe(true);
  });
});

describe('contemPrecoLiteral', () => {
  // A falha exata que o marcador existe para impedir: o modelo ignora o
  // {{PRECO:id}} e digita o número. Sem marcador sobrando, nada mais pegaria.
  it('pega o preço que o modelo escreveu por conta própria', () => {
    expect(contemPrecoLiteral('Sai por R$ 39,90 hoje!')).toBe(true);
    expect(contemPrecoLiteral('custa 39,90')).toBe(true);
    expect(contemPrecoLiteral('sai por 40 reais')).toBe(true);
  });

  it('deixa passar a resposta que usa o marcador', () => {
    expect(contemPrecoLiteral('Sai por {{PRECO:abc}} hoje')).toBe(false);
    expect(contemPrecoLiteral('Temos em azul, P ao GG')).toBe(false);
    expect(contemPrecoLiteral('chega em 5 dias')).toBe(false);
  });
});

describe('higiene da resposta', () => {
  it('rejeita link e @menção', () => {
    expect(contemLinkOuMencao('compra em https://loja.com')).toBe(true);
    expect(contemLinkOuMencao('chama no www.loja.com')).toBe(true);
    expect(contemLinkOuMencao('fala com @vendedor')).toBe(true);
    expect(contemLinkOuMencao('Temos em azul, R$ 49,90')).toBe(false);
  });

  it('trunca em 140 caracteres sem cortar palavra ao meio', () => {
    const longo = 'palavra '.repeat(40).trim();
    const cortado = truncar(longo);
    expect(cortado.length).toBeLessThanOrEqual(140);
    expect(cortado.endsWith('palavra')).toBe(true);
  });

  it('deixa passar intacta a resposta que já cabe', () => {
    expect(truncar('Temos sim, R$ 49,90')).toBe('Temos sim, R$ 49,90');
  });
});
