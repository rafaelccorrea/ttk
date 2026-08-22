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
