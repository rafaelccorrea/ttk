import {
  aceiteEstaVigente,
  aplicarPrecos,
  clusterKeyDe,
  expirouNaFila,
  IDADE_MAXIMA_NA_FILA_MS,
  podeTransicionarEntrega,
  statusInicialDeEntrega,
  VERSAO_DO_TERMO_AUTO,
  contemLinkOuMencao,
  contemPrecoLiteral,
  decidirResposta,
  ehAltoValor,
  ehListaNegra,
  contemMetaLinguagem,
  ehPergunta,
  humanizarMarcadores,
  normalizarTexto,
  truncarSeguro,
  valoresPermitidos,
  sanitizarPerguntaDaBase,
  LiveReplyService,
} from './live-reply.service';
import { sanitizarHtml } from './live-config.service';
import { LiveFaq } from './entities/live-faq.entity';
import { LiveReply } from './entities/live-reply.entity';

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

  /*
   * A correção que salvou o modo automático de ser inútil.
   *
   * A versão anterior barrava QUALQUER número com cara de dinheiro — e "frete
   * grátis acima de R$ 99" é informação que o próprio vendedor cadastrou em
   * `shippingInfo`. Numa base que fala de frete (quase todas), praticamente
   * nenhuma resposta chegava ao chat: tudo virava escalação.
   *
   * A pergunta certa não é "tem número?", é "esse número é NOSSO?".
   */
  describe('com os valores que a base autoriza', () => {
    // Como a base montaria: 1499.90 de preço e um frete escrito à mão.
    const base = valoresPermitidos({
      precos: ['1499.90'],
      textos: ['Frete grátis acima de R$ 99', 'Parcelamos em até 12x'],
    });

    it('deixa a resposta repetir o frete que o vendedor cadastrou', () => {
      expect(
        contemPrecoLiteral('Sai com frete grátis acima de R$ 99!', base),
      ).toBe(false);
    });

    it('aceita o mesmo valor escrito de outro jeito', () => {
      // O vendedor escreveu "R$ 99"; o modelo pode dizer "99 reais". É o mesmo
      // valor, e a comparação é por dígito justamente por isso.
      expect(contemPrecoLiteral('o frete sai de graça acima de 99 reais', base)).toBe(
        false,
      );
      expect(contemPrecoLiteral('são 99 conto pra frete grátis', base)).toBe(false);
    });

    it('continua barrando o valor que a base não tem', () => {
      // 89,90 não está em lugar nenhum da base: é invenção, e invenção sobre
      // dinheiro é exatamente o que não pode ir ao chat.
      expect(contemPrecoLiteral('Hoje sai por R$ 89,90!', base)).toBe(true);
      expect(contemPrecoLiteral('faço por 200 reais', base)).toBe(true);
    });

    it('barra tudo quando a base não tem valor nenhum', () => {
      // Base sem preço cadastrado não autoriza número nenhum — o padrão é
      // fechado, não aberto.
      expect(contemPrecoLiteral('Sai por R$ 99', new Set())).toBe(true);
    });

    it('não confunde tamanho, prazo e quantidade com dinheiro', () => {
      expect(contemPrecoLiteral('chega em 5 dias', base)).toBe(false);
      expect(contemPrecoLiteral('temos do 34 ao 42', base)).toBe(false);
      expect(contemPrecoLiteral('vem 3 unidades no kit', base)).toBe(false);
    });
  });
});

/*
 * O rascunho da escalação é lido por um humano no meio da live: um
 * "{{PRECO:uuid}}" na tela é lixo de template, enquanto "[produto sem preço na
 * base]" diz exatamente o que fazer. A humanização roda SÓ no caminho escalado
 * — a decisão de escalar já foi tomada pelo `resolvido` antes dela.
 */
describe('humanizarMarcadores', () => {
  it('troca o marcador cru por um aviso legível', () => {
    expect(humanizarMarcadores('{{PRECO:db7f1ece-df97}}')).toBe(
      '[produto sem preço na base]',
    );
    expect(
      humanizarMarcadores('O S25 FE sai por {{PRECO:95121c87}} hoje.'),
    ).toBe('O S25 FE sai por [produto sem preço na base] hoje.');
  });

  it('varre chave órfã de marcador malformado', () => {
    expect(humanizarMarcadores('sai por {{PRECO:abc} no pix')).not.toContain('{{');
    expect(humanizarMarcadores('custa }} 50')).not.toContain('}}');
  });

  it('não mexe em texto sem marcador', () => {
    expect(humanizarMarcadores('Sai por R$ 49,90 com frete grátis')).toBe(
      'Sai por R$ 49,90 com frete grátis',
    );
  });
});

/*
 * O cliente da live não sabe que existe uma "base" — resposta que fala de
 * bastidor quebra o personagem do vendedor em público. A palavra "base"
 * SOLTA é nome de produto legítimo ("S26 base") e não pode ser barrada.
 */
describe('contemMetaLinguagem', () => {
  it('escala a resposta que confessa o bastidor', () => {
    expect(contemMetaLinguagem('Tem o S25 FE, mas a base não informa desconto.')).toBe(true);
    expect(contemMetaLinguagem('Esse produto não está cadastrado ainda.')).toBe(true);
    expect(contemMetaLinguagem('Não foi informado o prazo de entrega.')).toBe(true);
    expect(contemMetaLinguagem('Consta na base de conhecimento como esgotado.')).toBe(true);
    expect(contemMetaLinguagem('O sistema não achou esse item.')).toBe(true);
  });

  it('não confunde produto chamado "base" com fala de bastidor', () => {
    expect(contemMetaLinguagem('O S26 base sai por R$ 1.299,00 hoje!')).toBe(false);
    expect(contemMetaLinguagem('Temos o S26 base e o S25 Ultra na live.')).toBe(false);
    expect(contemMetaLinguagem('Tem frete grátis acima de R$ 99.')).toBe(false);
  });
});

describe('higiene da resposta', () => {
  it('rejeita link e @menção', () => {
    expect(contemLinkOuMencao('compra em https://loja.com')).toBe(true);
    expect(contemLinkOuMencao('chama no www.loja.com')).toBe(true);
    expect(contemLinkOuMencao('fala com @vendedor')).toBe(true);
    expect(contemLinkOuMencao('Temos em azul, R$ 49,90')).toBe(false);
  });

  // O corte por si só é testado em 'truncarSeguro': não existe mais um
  // `truncar` simples no serviço, porque um helper de corte que não sabe de
  // preço é o caminho para republicar "R$ 1.4" no chat de alguém.
  it('trunca sem cortar palavra ao meio', () => {
    const longo = 'palavra '.repeat(40).trim();
    const { texto: cortado } = truncarSeguro(longo);
    expect(cortado.length).toBeLessThanOrEqual(140);
    expect(cortado.endsWith('palavra')).toBe(true);
  });

  it('deixa passar intacta a resposta que já cabe', () => {
    expect(truncarSeguro('Temos sim, R$ 49,90').texto).toBe('Temos sim, R$ 49,90');
  });
});

/*
 * O corte que não pode publicar preço errado. Um "R$ 1.299,00" partido no meio
 * vira "R$ 1.29" — um valor que a loja não pratica, sem marcador sobrando para
 * escalar e sem `contemPrecoLiteral` para acusar (ele roda antes da
 * substituição).
 */
describe('truncarSeguro', () => {
  it('nunca corta um preço ao meio, e avisa quando o preço ficou de fora', () => {
    const texto = `${'palavra '.repeat(20)}sai por R$ 1.299,00 hoje`;
    const { texto: cortado, precoPerdido } = truncarSeguro(texto);
    expect(cortado.length).toBeLessThanOrEqual(140);
    expect(cortado).not.toMatch(/R\$\s*1\.29(?!9)/);
    expect(cortado).not.toContain('R$');
    expect(precoPerdido).toBe(true);
  });

  it('não mexe no que já cabe, preço incluído', () => {
    const ok = truncarSeguro('Sai por R$ 1.299,00 com frete grátis');
    expect(ok.texto).toBe('Sai por R$ 1.299,00 com frete grátis');
    expect(ok.precoPerdido).toBe(false);
  });

  /*
   * Este teste nasce de um bug que passou pela revisão inteira, e a lição é
   * sobre FIXTURE, não sobre lógica: os casos acima usam "R$ 1.299,00", escrito
   * à mão. Só que o detector antigo exigia o ponto de milhar e o
   * `aplicarPrecos` produzia "1499,90" — então a suíte testava um formato que o
   * código nunca emitia, e a proteção estava inerte para TODO produto de quatro
   * dígitos. O chat recebia "…sai por apenas R$", marcado como entregue.
   *
   * Daí a regra aqui: o preço dos testes vem de `aplicarPrecos`, nunca digitado.
   */
  it('protege o preço no formato que a substituição realmente escreve', () => {
    const precos = new Map([['p1', '1499.90']]);
    const { texto: comPreco } = aplicarPrecos(
      `${'palavra '.repeat(20)}sai por apenas {{PRECO:p1}} no pix`,
      precos,
    );

    const { texto: cortado, precoPerdido } = truncarSeguro(comPreco);
    expect(cortado.length).toBeLessThanOrEqual(140);
    // Nem valor partido, nem "R$" órfão prometendo um número que não está lá.
    expect(cortado).not.toMatch(/R\$\s*1\.?4\d?9?(?!9,90)/);
    expect(cortado).not.toMatch(/R\$\s*$/);
    expect(precoPerdido).toBe(true);
  });

  it('reconhece preço de quatro dígitos com e sem separador de milhar', () => {
    // Com separador é o que `formatarPreco` emite hoje; sem separador é o que
    // ele emitia antes, e pode estar numa resposta parada na fila.
    for (const escrito of ['R$ 1.499,90', 'R$ 1499,90']) {
      const texto = `${'palavra '.repeat(20)}sai por ${escrito} hoje`;
      const { texto: cortado, precoPerdido } = truncarSeguro(texto);
      expect(precoPerdido).toBe(true);
      expect(cortado).not.toMatch(/R\$\s*1\.?4/);
    }
  });
});

/*
 * O HTML de diagnóstico. A regra é dura: nenhum caractere digitado por um
 * espectador — nem o perfil ou o avatar dele — pode chegar à tabela.
 */
describe('sanitizarHtml', () => {
  it('tira texto, href, src e trunca rótulo em aspas simples', () => {
    const bruto =
      `<div class="chat"><a href="/@espectadora_maria">` +
      `<img src="https://p16.tiktok.com/avatar-1234.jpg" alt="Maria"></a>` +
      `<span aria-label='meu cpf e 123.456.789-00 me chama la'>Maria: meu cpf e 123</span></div>`;
    const limpo = sanitizarHtml(bruto);

    expect(limpo).not.toContain('espectadora_maria');
    expect(limpo).not.toContain('avatar-1234');
    expect(limpo).not.toContain('Maria');
    expect(limpo).not.toContain('123.456.789-00');
    // A estrutura, que é o que serve para escrever um seletor novo, fica.
    expect(limpo).toContain('class="chat"');
  });
});

/*
 * Modo automático (fase 2). O que é testado aqui é a máquina de estados da
 * ENTREGA — a parte que decide se um comentário sai, se é descartado, e se uma
 * confirmação repetida conta duas vezes. Nada disso depende do banco nem do
 * modelo, e é justamente a parte cujo erro aparece como "o vendedor postou a
 * mesma coisa duas vezes na live" ou "a métrica de entrega mente".
 */
describe('statusInicialDeEntrega', () => {
  it('só põe na fila o que a run automática aprovou para envio', () => {
    expect(statusInicialDeEntrega('auto', 'enviar')).toBe('pendente');
  });

  it('não põe na fila o que a decisão barrou, mesmo em modo automático', () => {
    // Escalar quer dizer "isto não sai sem um humano olhar". Deixar pendente
    // faria o app postar exatamente o que o motor acabou de segurar.
    expect(statusInicialDeEntrega('auto', 'escalar')).toBe('nao_aplica');
    expect(statusInicialDeEntrega('auto', 'silenciar')).toBe('nao_aplica');
  });

  it('nunca põe na fila em modo painel', () => {
    expect(statusInicialDeEntrega('painel', 'enviar')).toBe('nao_aplica');
    expect(statusInicialDeEntrega('painel', 'escalar')).toBe('nao_aplica');
  });
});

describe('transição do status de entrega', () => {
  it('deixa a fila sair para qualquer um dos três desfechos', () => {
    expect(podeTransicionarEntrega('pendente', 'enviada')).toBe(true);
    expect(podeTransicionarEntrega('pendente', 'falhou')).toBe(true);
    expect(podeTransicionarEntrega('pendente', 'cancelada')).toBe(true);
  });

  it('trava a confirmação repetida — é o que impede contar duas entregas', () => {
    expect(podeTransicionarEntrega('enviada', 'enviada')).toBe(false);
    expect(podeTransicionarEntrega('falhou', 'falhou')).toBe(false);
    expect(podeTransicionarEntrega('cancelada', 'cancelada')).toBe(false);
  });

  it('não deixa um desfecho virar outro depois de fechado', () => {
    expect(podeTransicionarEntrega('enviada', 'falhou')).toBe(false);
    expect(podeTransicionarEntrega('cancelada', 'enviada')).toBe(false);
    expect(podeTransicionarEntrega('falhou', 'enviada')).toBe(false);
  });

  it('ignora confirmação sobre resposta que nunca teve envio', () => {
    expect(podeTransicionarEntrega('nao_aplica', 'enviada')).toBe(false);
    expect(podeTransicionarEntrega('nao_aplica', 'pendente')).toBe(false);
  });
});

describe('descarte da fila por idade', () => {
  const nascimento = new Date('2026-08-17T20:00:00.000Z');
  const em = (ms: number) => new Date(nascimento.getTime() + ms);

  it('segura o que ainda está dentro da janela', () => {
    expect(expirouNaFila(nascimento, em(0))).toBe(false);
    expect(expirouNaFila(nascimento, em(IDADE_MAXIMA_NA_FILA_MS))).toBe(false);
  });

  it('descarta o que passou — responder tarde é pior que não responder', () => {
    expect(expirouNaFila(nascimento, em(IDADE_MAXIMA_NA_FILA_MS + 1))).toBe(
      true,
    );
    expect(expirouNaFila(nascimento, em(5 * 60_000))).toBe(true);
  });
});

describe('aceite do termo de risco', () => {
  const em = new Date('2026-08-17T12:00:00.000Z');

  it('autoriza só quem aceitou a versão vigente', () => {
    expect(
      aceiteEstaVigente({
        liveAutoAcceptedAt: em,
        liveAutoAcceptedVersion: VERSAO_DO_TERMO_AUTO,
      }),
    ).toBe(true);
  });

  it('recusa quem nunca aceitou', () => {
    expect(
      aceiteEstaVigente({
        liveAutoAcceptedAt: null,
        liveAutoAcceptedVersion: null,
      }),
    ).toBe(false);
  });

  it('recusa o aceite de uma redação anterior', () => {
    // Quem clicou no termo antigo consentiu com o risco antigo: o texto mudou
    // porque o risco mudou, e reaproveitar aquele clique é consentimento que
    // ninguém deu.
    expect(
      aceiteEstaVigente({
        liveAutoAcceptedAt: em,
        liveAutoAcceptedVersion: '2020-01-01',
      }),
    ).toBe(false);
  });
});

/**
 * A realimentação da base (fase 3).
 *
 * O que estes testes protegem: uma correção do vendedor SUBSTITUI a entrada
 * errada em vez de virar uma segunda linha concorrente, e a curadoria dele
 * nasce como `manual` — que é o que a faz sobreviver ao reprocessamento da
 * gravação, onde tudo que veio da IA é apagado e refeito.
 */
function servicoParaPromocao(estado: {
  faqExistente?: Partial<LiveFaq> | null;
  resposta?: Partial<LiveReply>;
  mensagem?: { id: string; text: string } | null;
}) {
  const respostaBase = {
    id: 'r1',
    userId: 'u1',
    liveRunId: 'run1',
    chatMessageId: 'm1',
    text: 'Sai por R$ 89,90.',
    sourceProductIds: [] as string[],
    copiedAt: null as Date | null,
    ...estado.resposta,
  };
  const salvos: Record<string, unknown[]> = { faq: [], respostas: [] };

  const faqRepo = {
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: unknown) => {
      salvos.faq.push(x);
      return x;
    }),
    // `faqParecida` recarrega pelo repositório antes de salvar, para que o
    // save vire UPDATE. Sem isto o teste do caminho de correção passaria
    // enquanto a produção inseriria uma linha nova.
    findOneBy: jest.fn(async () => estado.faqExistente ?? null),
    manager: {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) =>
        cb({
          query: jest.fn(async (sql: string) =>
            sql.includes('SET LOCAL')
              ? []
              : estado.faqExistente
                ? [estado.faqExistente]
                : [],
          ),
        }),
      ),
    },
  };

  const servico = new LiveReplyService(
    { findOneBy: jest.fn(async () => ({ id: 'run1', userId: 'u1', knowledgeSessionId: 's1' })) } as never,
    {
      findOneBy: jest.fn(async () =>
        estado.mensagem === undefined
          ? { id: 'm1', text: 'chega quando?' }
          : estado.mensagem,
      ),
    } as never,
    {
      findOneBy: jest.fn(async () => respostaBase),
      save: jest.fn(async (x: unknown) => {
        salvos.respostas.push(x);
        return x;
      }),
    } as never,
    {} as never,
    faqRepo as never,
    {} as never,
    {} as never,
    // O repositório de métricas de audiência — a promoção para a base não o
    // toca, então um objeto vazio basta.
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { servico, faqRepo, salvos, respostaBase };
}

describe('realimentação da base', () => {
  it('cria a entrada como manual, não como ia', async () => {
    // `manual` é o que sobrevive ao `delete({ origin: 'ia' })` do
    // reprocessamento. Nascer como 'ia' apagaria a curadoria do vendedor no dia
    // em que ele reenviasse a gravação — o único dado aqui que não dá refazer.
    const { servico, salvos } = servicoParaPromocao({});
    await servico.promoverParaBase('u1', 'r1');
    expect((salvos.faq[0] as { origin: string }).origin).toBe('manual');
    expect((salvos.faq[0] as { liveSessionId: string }).liveSessionId).toBe('s1');
  });

  it('guarda o texto corrigido, e não o do copiloto', async () => {
    const { servico, salvos } = servicoParaPromocao({});
    await servico.promoverParaBase('u1', 'r1', 'Chega em até 7 dias úteis.');
    expect((salvos.faq[0] as { answer: string }).answer).toBe(
      'Chega em até 7 dias úteis.',
    );
  });

  it('corrige a entrada existente em vez de criar uma concorrente', async () => {
    // Duas respostas para a mesma pergunta deixam o desempate por prioridade
    // decidir — e o copiloto poderia seguir usando justamente a versão que o
    // vendedor acabou de recusar.
    const { servico, faqRepo, salvos } = servicoParaPromocao({
      faqExistente: { id: 'f1', question: 'chega quando?', answer: 'velha', priority: 0, origin: 'ia' },
    });
    await servico.promoverParaBase('u1', 'r1', 'nova resposta');
    expect(faqRepo.create).not.toHaveBeenCalled();
    expect((salvos.faq[0] as { id: string }).id).toBe('f1');
    expect((salvos.faq[0] as { answer: string }).answer).toBe('nova resposta');
    expect((salvos.faq[0] as { origin: string }).origin).toBe('manual');
  });

  it('só amarra ao produto quando a resposta se apoiou em um só', async () => {
    // Com dois, a pergunta era comparativa: prender a um deles faria a entrada
    // sumir da base quando aquele item fosse apagado.
    const um = servicoParaPromocao({ resposta: { sourceProductIds: ['p1'] } });
    await um.servico.promoverParaBase('u1', 'r1');
    expect((um.salvos.faq[0] as { liveProductId: string | null }).liveProductId).toBe('p1');

    const dois = servicoParaPromocao({ resposta: { sourceProductIds: ['p1', 'p2'] } });
    await dois.servico.promoverParaBase('u1', 'r1');
    expect((dois.salvos.faq[0] as { liveProductId: string | null }).liveProductId).toBeNull();
  });

  it('conta como aproveitada: salvar é sinal mais forte que copiar', async () => {
    const { servico, salvos } = servicoParaPromocao({});
    await servico.promoverParaBase('u1', 'r1');
    expect((salvos.respostas[0] as { copiedAt: Date | null }).copiedAt).toBeInstanceOf(Date);
  });

  it('recusa resposta vazia', async () => {
    const { servico } = servicoParaPromocao({});
    await expect(servico.promoverParaBase('u1', 'r1', '   ')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('recusa quando a pergunta já saiu pela retenção de 30 dias', async () => {
    const { servico } = servicoParaPromocao({ mensagem: null });
    await expect(servico.promoverParaBase('u1', 'r1')).rejects.toThrow();
  });
});

describe('sanitização da pergunta que vira base', () => {
  /*
   * O chat some em 30 dias; a base não. Promover a pergunta de um espectador
   * tira o dado dele do regime de retenção, torna-o permanente e ainda o manda
   * à OpenAI no `system` de toda live seguinte. O que é identificável por
   * FORMA precisa sair antes de atravessar essa porta.
   */
  it('remove e-mail, telefone, CPF, CEP, @ e link', () => {
    expect(sanitizarPerguntaDaBase('manda pro maria@gmail.com')).toBe(
      'manda pro [removido]',
    );
    expect(sanitizarPerguntaDaBase('meu zap (11) 98765-4321')).toBe(
      'meu zap [removido]',
    );
    expect(sanitizarPerguntaDaBase('cpf 123.456.789-00 ok?')).toBe(
      'cpf [removido] ok?',
    );
    expect(sanitizarPerguntaDaBase('meu cep 01310-100, chega?')).toBe(
      'meu cep [removido], chega?',
    );
    expect(sanitizarPerguntaDaBase('fala com @lojadaana')).toBe(
      'fala com [removido]',
    );
    expect(sanitizarPerguntaDaBase('vi em https://x.com/abc')).toBe(
      'vi em [removido]',
    );
  });

  it('NÃO apaga número solto — é o que a base existe para responder', () => {
    /*
     * O erro oposto é tão ruim quanto: varrer dígitos por precaução destruiria
     * "tem o de 1299?" e "quanto custa o kit de 3", que são exatamente as
     * perguntas que a base precisa casar nas próximas lives.
     */
    expect(sanitizarPerguntaDaBase('tem o de 1299?')).toBe('tem o de 1299?');
    expect(sanitizarPerguntaDaBase('quanto custa o kit de 3')).toBe(
      'quanto custa o kit de 3',
    );
    expect(sanitizarPerguntaDaBase('sai por 89,90 mesmo?')).toBe(
      'sai por 89,90 mesmo?',
    );
  });

  it('mantém a pergunta legível para o trigrama continuar casando', () => {
    // A entrada da base ainda precisa casar com a mesma dúvida na live que vem.
    expect(sanitizarPerguntaDaBase('  chega   quando  em   SP? ')).toBe(
      'chega quando em SP?',
    );
  });

  it('aguenta texto vazio sem explodir', () => {
    expect(sanitizarPerguntaDaBase('')).toBe('');
  });
});
