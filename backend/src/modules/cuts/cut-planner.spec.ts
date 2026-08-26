import {
  ajustarAoSilencio,
  blocosDeTranscricao,
  espacosLivres,
  planejarRapido,
  sobrepoe,
  srtDoTrecho,
  validarSugestoes,
} from './cut-planner';

describe('cut-planner — modo rápido', () => {
  it('espalha as janelas pela fonte inteira, do começo ao fim', () => {
    const cortes = planejarRapido(600, 5, 30, 60);
    expect(cortes).toHaveLength(5);
    expect(cortes[0].inicio).toBe(0);
    expect(cortes[4].fim).toBe(600);
    for (const c of cortes) {
      expect(c.fim - c.inicio).toBeGreaterThanOrEqual(30);
      expect(c.fim - c.inicio).toBeLessThanOrEqual(60);
      expect(c.origem).toBe('rapido');
    }
  });

  it('puxa as bordas para o silêncio mais próximo', () => {
    // Alvo de 45 s; há um silêncio em 47–48 s, dentro da folga de 15 s.
    const cortes = planejarRapido(600, 1, 30, 60, [{ inicio: 47, fim: 48 }]);
    expect(cortes[0].fim).toBe(47.5);
  });

  it('nunca estoura a faixa mesmo com silêncio longe', () => {
    const cortes = planejarRapido(600, 1, 30, 60, [{ inicio: 100, fim: 101 }]);
    expect(cortes[0].fim - cortes[0].inicio).toBe(45);
  });

  it('não sobrepõe os trechos que a IA já escolheu', () => {
    const daIa = [{ inicio: 0, fim: 45 }];
    const cortes = planejarRapido(600, 3, 30, 60, [], daIa);
    expect(cortes).toHaveLength(3);
    for (const c of cortes) expect(sobrepoe(c, daIa)).toBe(false);
  });

  it('encolhe o alvo até o mínimo quando a fonte é curta para o pedido', () => {
    // 6 cortes de 30–60 s em 2:30: com 45 s só cabem 3; com 30 s cabem 5.
    const cortes = planejarRapido(150, 6, 30, 60);
    expect(cortes.length).toBeGreaterThanOrEqual(5);
    for (const c of cortes) expect(c.fim - c.inicio).toBeGreaterThanOrEqual(30);
  });

  it('numa fonte mais curta que o alvo, entrega o que cabe', () => {
    const cortes = planejarRapido(20, 3, 15, 30);
    expect(cortes.length).toBeGreaterThanOrEqual(1);
    expect(cortes[0].inicio).toBe(0);
    // Alvo encolhe até o mínimo (15 s); nunca passa do fim da fonte.
    expect(cortes[0].fim).toBeGreaterThanOrEqual(15);
    expect(cortes[0].fim).toBeLessThanOrEqual(20);
  });
});

describe('cut-planner — sugestões da IA', () => {
  it('aceita trechos válidos com título e gancho', () => {
    const aceitos = validarSugestoes(
      [{ inicio: 10, fim: 50, titulo: ' Preço  imbatível ', gancho: 'Olha isso', motivo: 'oferta' }],
      600,
      5,
      30,
      60,
    );
    expect(aceitos).toEqual([
      {
        inicio: 10,
        fim: 50,
        title: 'Preço imbatível',
        hook: 'Olha isso',
        reason: 'oferta',
        origem: 'ia',
      },
    ]);
  });

  it('descarta trecho fora da fonte, invertido, fora da faixa ou sobreposto', () => {
    const aceitos = validarSugestoes(
      [
        { inicio: 10, fim: 50 },
        { inicio: 590, fim: 700 }, // passa do fim
        { inicio: 80, fim: 70 }, // invertido
        { inicio: 100, fim: 300 }, // 200 s > máx 60
        { inicio: 20, fim: 55 }, // sobrepõe o primeiro
        { inicio: 'x', fim: 5 }, // lixo
        { inicio: 200, fim: 240 },
      ],
      600,
      10,
      30,
      60,
    );
    expect(aceitos.map((a) => [a.inicio, a.fim])).toEqual([
      [10, 50],
      [200, 240],
    ]);
  });

  it('para na quantidade pedida', () => {
    const aceitos = validarSugestoes(
      [
        { inicio: 0, fim: 40 },
        { inicio: 100, fim: 140 },
        { inicio: 200, fim: 240 },
      ],
      600,
      2,
      30,
      60,
    );
    expect(aceitos).toHaveLength(2);
  });
});

describe('cut-planner — utilitários', () => {
  it('ajustarAoSilencio devolve o alvo quando nada está na folga', () => {
    expect(ajustarAoSilencio(45, [], 10)).toBe(45);
    expect(ajustarAoSilencio(45, [{ inicio: 70, fim: 71 }], 10)).toBe(45);
  });

  it('blocos de transcrição arredondam para cima e nunca dão zero', () => {
    expect(blocosDeTranscricao(0, 10)).toBe(1);
    expect(blocosDeTranscricao(600, 10)).toBe(1);
    expect(blocosDeTranscricao(601, 10)).toBe(2);
    expect(blocosDeTranscricao(3600, 10)).toBe(6);
  });
});

describe('cut-planner — legenda (SRT)', () => {
  const fala = [
    { inicio: 0, fim: 4, texto: 'antes do corte' },
    { inicio: 8, fim: 12, texto: 'Olha só esse preço' },
    { inicio: 12, fim: 20, texto: 'Esse é o kit completo com três itens que a galera mais pede na live' },
    { inicio: 40, fim: 45, texto: 'depois do corte' },
  ];

  it('inclui só os segmentos do trecho, com tempo relativo ao corte', () => {
    const srt = srtDoTrecho(fala, 10, 30);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,000\nOlha só esse preço');
    expect(srt).toContain('2\n00:00:02,000 --> ');
    expect(srt).toContain(' --> 00:00:10,000\n');
    expect(srt).not.toContain('antes do corte');
    expect(srt).not.toContain('depois do corte');
  });

  it('quebra linha longa em duas', () => {
    const srt = srtDoTrecho(fala, 12, 20);
    const bloco = srt.trim().split('\n\n')[0].split('\n');
    expect(bloco.length).toBe(4); // índice, tempo, 2 linhas
  });

  it('fatia frase comprida em vários cues curtos, sem cue de mais de duas linhas', () => {
    const longa = [
      {
        inicio: 0,
        fim: 6,
        texto:
          'Bom, basicamente, é um vídeo curto, um vídeo rápido, só que bem intuitivo, né? Então, a gente, o que que a gente',
      },
    ];
    const srt = srtDoTrecho(longa, 0, 10);
    const blocos = srt.trim().split('\n\n');
    expect(blocos.length).toBeGreaterThan(1);
    for (const b of blocos) {
      const linhas = b.split('\n').slice(2);
      expect(linhas.length).toBeLessThanOrEqual(2);
      for (const l of linhas) expect(l.length).toBeLessThanOrEqual(30);
    }
    expect(blocos[blocos.length - 1]).toContain(' --> 00:00:06,000');
  });

  it('devolve vazio quando não há fala no trecho', () => {
    expect(srtDoTrecho(fala, 25, 35)).toBe('');
  });
});

describe('cut-planner — complemento nos espaços livres', () => {
  it('preenche os dois lados de um trecho da IA sem desperdiçar vagas', () => {
    // Fonte de 151 s, IA ficou com 57–117; sobram 0–57 e 117–151.
    const daIa = [{ inicio: 57, fim: 117 }];
    const cortes = planejarRapido(151, 5, 30, 60, [], daIa);
    expect(cortes.length).toBeGreaterThanOrEqual(2);
    for (const c of cortes) {
      expect(sobrepoe(c, daIa)).toBe(false);
      expect(c.fim - c.inicio).toBeGreaterThanOrEqual(30);
    }
    expect(cortes.some((c) => c.fim <= 57)).toBe(true);
    expect(cortes.some((c) => c.inicio >= 117)).toBe(true);
  });

  it('espacosLivres funde trechos sobrepostos e recorta nas bordas', () => {
    expect(espacosLivres(100, [{ inicio: -5, fim: 10 }, { inicio: 5, fim: 20 }, { inicio: 90, fim: 120 }]))
      .toEqual([{ inicio: 20, fim: 90 }]);
  });
});
