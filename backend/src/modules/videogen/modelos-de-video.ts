import type { SceneAudioMode, SceneKind } from '../campaigns/entities/campaign-scene.entity';

/**
 * Catálogo dos modelos de vídeo que a Fábrica pode usar, e a regra de qual
 * entra em cada tipo de cena.
 *
 * Existe para RESPONDER "qual IA é melhor para qual cenário" com dado, não
 * com lembrança: cada cena grava o modelo que a gerou (`generated_media.model`),
 * o padrão por perfil vem de variável de ambiente (troca sem deploy) e uma
 * cena pode forçar um modelo específico (`campaign_scenes.modelo`) para
 * comparar lado a lado. Custos em créditos do PLANO da Higgsfield (CLI).
 */
export interface ModeloDeVideo {
  id: string;
  label: string;
  /** Fala nativa com lip-sync em pt-BR? (Kling 3.0: só en/zh/ja/ko/es.) */
  falaPtBr: boolean;
  /** Custo por clipe de 5 s, em créditos do plano (referência ago/2026). */
  custoPlano: number;
  /** Aceita `--audio-references` (clonagem do timbre da voz-semente). */
  vozReferencia?: boolean;
  /** Parâmetros extras que a CLI exige para este modelo num clipe 9:16 de 5 s. */
  args: (comFala: boolean) => string[];
}

export const MODELOS_DE_VIDEO: ModeloDeVideo[] = [
  {
    id: 'kling3_0_turbo',
    label: 'Kling 3.0 Turbo (rápido, barato)',
    falaPtBr: false,
    custoPlano: 7.5,
    args: () => ['--aspect_ratio', '9:16', '--duration', '5', '--resolution', '720p'],
  },
  {
    id: 'kling3_0',
    label: 'Kling 3.0 (qualidade)',
    falaPtBr: false,
    custoPlano: 15,
    args: (comFala) => [
      '--aspect_ratio', '9:16', '--duration', '5', '--resolution', '720p',
      '--sound', comFala ? 'on' : 'off',
    ],
  },
  {
    id: 'seedance_2_0',
    label: 'Seedance 2.0 (fala em pt-BR)',
    falaPtBr: true,
    custoPlano: 22.5,
    vozReferencia: true,
    args: (comFala) => [
      '--aspect_ratio', '9:16', '--duration', '5', '--resolution', '720p',
      '--generate_audio', comFala ? 'true' : 'false',
    ],
  },
  {
    id: 'seedance_2_0_mini',
    label: 'Seedance 2.0 Mini (fala em pt-BR, mais barato)',
    falaPtBr: true,
    custoPlano: 10,
    vozReferencia: true,
    args: (comFala) => [
      '--aspect_ratio', '9:16', '--duration', '5', '--resolution', '720p',
      '--generate_audio', comFala ? 'true' : 'false',
    ],
  },
  {
    id: 'veo3_1_lite',
    label: 'Veo 3.1 Lite (experimental)',
    falaPtBr: true,
    custoPlano: 20,
    // O Veo não aceita 5 s: 4/6/8. Seis é o mais próximo — a montagem corta.
    args: (comFala) => [
      '--aspect_ratio', '9:16', '--duration', '6',
      '--generate_audio', comFala ? 'true' : 'false',
    ],
  },
];

export function modeloDeVideo(id: string | null | undefined): ModeloDeVideo | undefined {
  return id ? MODELOS_DE_VIDEO.find((m) => m.id === id) : undefined;
}

/**
 * Perfis de cena — é por eles que se compara IA com IA:
 *  - `apresentador_fala`: pessoa em quadro FALANDO (lip-sync, idioma);
 *  - `apresentador_mudo`: pessoa em quadro sem fala (só gesto e expressão);
 *  - `tela`: foto do produto que é uma tela (app, site) — a UI não pode mudar;
 *  - `produto`: objeto físico animado a partir da foto real.
 */
export type PerfilDeCena = 'apresentador_fala' | 'apresentador_mudo' | 'tela' | 'produto';

export function perfilDaCena(opts: {
  tipo: SceneKind;
  modoAudio: SceneAudioMode;
  /** Como o produto se usa ("navegar no sistema pelo celular") — denuncia tela. */
  comoUsa?: string | null;
}): PerfilDeCena {
  const comPessoa = opts.tipo === 'apresentador' || opts.tipo === 'apresentador_produto';
  if (comPessoa) return opts.modoAudio === 'fala' ? 'apresentador_fala' : 'apresentador_mudo';
  return /\b(tela|celular|app|sistema|site|aplicativo|painel|dashboard)\b/i.test(opts.comoUsa ?? '')
    ? 'tela'
    : 'produto';
}

/**
 * Padrão por perfil. `HIGGSFIELD_VIDEO_MODEL_<PERFIL>` (maiúsculas) troca
 * sem deploy; `HIGGSFIELD_CLI_VIDEO_MODEL` continua valendo como padrão
 * geral das cenas mudas, e `HIGGSFIELD_CLI_SPEECH_VIDEO_MODEL` das faladas.
 */
export function modeloPadraoPorPerfil(
  perfil: PerfilDeCena,
  env: Record<string, string | undefined> = process.env,
): string {
  const especifico = env[`HIGGSFIELD_VIDEO_MODEL_${perfil.toUpperCase()}`];
  if (especifico) return especifico;
  if (perfil === 'apresentador_fala') {
    return env.HIGGSFIELD_CLI_SPEECH_VIDEO_MODEL ?? 'seedance_2_0';
  }
  return env.HIGGSFIELD_CLI_VIDEO_MODEL ?? 'kling3_0_turbo';
}

/** Opções que a tela mostra, com o padrão de cada perfil já resolvido. */
export function catalogoDeModelos(env: Record<string, string | undefined> = process.env) {
  const perfis: PerfilDeCena[] = ['apresentador_fala', 'apresentador_mudo', 'tela', 'produto'];
  return {
    modelos: MODELOS_DE_VIDEO.map(({ id, label, falaPtBr, custoPlano }) => ({
      id, label, falaPtBr, custoPlano,
    })),
    padrao: Object.fromEntries(perfis.map((p) => [p, modeloPadraoPorPerfil(p, env)])) as Record<
      PerfilDeCena,
      string
    >,
  };
}
