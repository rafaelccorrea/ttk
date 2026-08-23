import {
  catalogoDeModelos,
  modeloDeVideo,
  modeloPadraoPorPerfil,
  perfilDaCena,
} from './modelos-de-video';

describe('perfilDaCena', () => {
  it('apresentador falando é o perfil de fala (lip-sync, idioma)', () => {
    expect(perfilDaCena({ tipo: 'apresentador', modoAudio: 'fala' })).toBe('apresentador_fala');
    expect(perfilDaCena({ tipo: 'apresentador_produto', modoAudio: 'fala' })).toBe(
      'apresentador_fala',
    );
  });

  it('apresentador sem fala é mudo — não precisa do modelo que fala pt-BR', () => {
    expect(perfilDaCena({ tipo: 'apresentador', modoAudio: 'sem_fala' })).toBe(
      'apresentador_mudo',
    );
  });

  it('produto que é uma tela (app, sistema) tem perfil próprio', () => {
    expect(
      perfilDaCena({ tipo: 'produto_close', modoAudio: 'narracao', comoUsa: 'navegar no sistema pelo celular' }),
    ).toBe('tela');
    expect(
      perfilDaCena({ tipo: 'mao_produto', modoAudio: 'narracao', comoUsa: 'passar nos lábios' }),
    ).toBe('produto');
  });
});

describe('modeloPadraoPorPerfil', () => {
  it('fala vai para o modelo que fala pt-BR; o resto para o barato', () => {
    expect(modeloPadraoPorPerfil('apresentador_fala', {})).toBe('seedance_2_0');
    expect(modeloPadraoPorPerfil('tela', {})).toBe('kling3_0_turbo');
    expect(modeloPadraoPorPerfil('produto', {})).toBe('kling3_0_turbo');
  });

  it('a variável por perfil vence as gerais', () => {
    const env = {
      HIGGSFIELD_VIDEO_MODEL_TELA: 'kling3_0',
      HIGGSFIELD_CLI_VIDEO_MODEL: 'kling3_0_turbo',
      HIGGSFIELD_CLI_SPEECH_VIDEO_MODEL: 'seedance_2_0_mini',
    };
    expect(modeloPadraoPorPerfil('tela', env)).toBe('kling3_0');
    expect(modeloPadraoPorPerfil('produto', env)).toBe('kling3_0_turbo');
    expect(modeloPadraoPorPerfil('apresentador_fala', env)).toBe('seedance_2_0_mini');
  });
});

describe('catálogo', () => {
  it('todo modelo que fala pt-BR pede áudio à CLI quando há fala', () => {
    for (const m of catalogoDeModelos({}).modelos.filter((x) => x.falaPtBr)) {
      const args = modeloDeVideo(m.id)!.args(true).join(' ');
      expect(args).toMatch(/--generate_audio true|--sound on/);
    }
  });

  it('o padrão de fala só aponta para modelo com pt-BR', () => {
    const { padrao, modelos } = catalogoDeModelos({});
    expect(modelos.find((m) => m.id === padrao.apresentador_fala)?.falaPtBr).toBe(true);
  });
});

describe('preço por modelo', () => {
  const { creditosDaCena, creditosDoModelo, MODELOS_DE_VIDEO } = jest.requireActual<
    typeof import('./modelos-de-video')
  >('./modelos-de-video');
  const { CREDIT_VALUE_BRL, HIGGSFIELD_PLAN_CREDIT_BRL, MIN_MARGIN } = jest.requireActual<
    typeof import('../billing/billing.config')
  >('../billing/billing.config');

  it('nenhum modelo é vendido abaixo de custo × margem (regra de ouro)', () => {
    for (const m of MODELOS_DE_VIDEO) {
      const custo = m.custoPlano * HIGGSFIELD_PLAN_CREDIT_BRL;
      expect(creditosDoModelo(m) * CREDIT_VALUE_BRL).toBeGreaterThanOrEqual(custo * MIN_MARGIN);
      expect(creditosDoModelo(m, true)).toBeGreaterThan(creditosDoModelo(m));
    }
  });

  it('a tabela vigente (plano Ultra mensal, US$ 0,043/crédito)', () => {
    const preco = (id: string, frame = false) => creditosDoModelo(MODELOS_DE_VIDEO.find((m) => m.id === id)!, frame);
    expect(preco('kling3_0_turbo')).toBe(30);
    expect(preco('kling3_0_turbo', true)).toBe(35);
    expect(preco('kling3_0')).toBe(55);
    expect(preco('seedance_2_0_mini')).toBe(40);
    expect(preco('seedance_2_0')).toBe(85);
    expect(preco('seedance_2_0', true)).toBe(90);
    expect(preco('veo3_1_lite')).toBe(75);
  });

  it('a cena resolve o modelo pelo perfil: fala custa mais que muda, produto paga o frame', () => {
    const env = {};
    expect(creditosDaCena({ tipo: 'apresentador', modoAudio: 'fala' }, { env })).toBe(85);
    expect(creditosDaCena({ tipo: 'apresentador', modoAudio: 'sem_fala' }, { env })).toBe(30);
    expect(creditosDaCena({ tipo: 'apresentador_produto', modoAudio: 'fala' }, { env })).toBe(90);
    expect(creditosDaCena({ tipo: 'produto_close', modoAudio: 'narracao' }, { env })).toBe(35);
    // Modelo forçado na cena manda sobre o padrão do perfil.
    expect(
      creditosDaCena({ tipo: 'apresentador', modoAudio: 'fala', modelo: 'seedance_2_0_mini' }, { env }),
    ).toBe(40);
    // Modelo desconhecido (env apontando para algo fora do catálogo) cai na tabela.
    expect(creditosDaCena({ tipo: 'apresentador', modoAudio: 'fala', modelo: 'xyz' }, { env })).toBe(60);
  });
});
