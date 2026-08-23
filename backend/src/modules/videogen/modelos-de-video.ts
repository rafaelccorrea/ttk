import {
  cenaSemPessoa,
  type SceneAudioMode,
  type SceneKind,
} from '../campaigns/entities/campaign-scene.entity';
import {
  ACTION_PRICES,
  creditosPorCustoBrl,
  HIGGSFIELD_PLAN_CREDIT_BRL,
} from '../billing/billing.config';

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
  /** Nome interno (logs, telemetria, comparação de IA). NUNCA vai para a tela. */
  label: string;
  /**
   * O que o cliente vê. Fala de resultado e preço — rápido, qualidade, voz
   * natural — e não de fornecedor: qual IA está por trás é decisão nossa, muda
   * sem aviso, e não é argumento de venda.
   */
  rotulo: string;
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
    rotulo: 'Rápido · econômico',
    falaPtBr: false,
    custoPlano: 7.5,
    args: () => ['--aspect_ratio', '9:16', '--duration', '5', '--resolution', '720p'],
  },
  {
    id: 'kling3_0',
    label: 'Kling 3.0 (qualidade)',
    rotulo: 'Qualidade',
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
    rotulo: 'Voz natural em pt-BR',
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
    rotulo: 'Voz natural em pt-BR · econômico',
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
    rotulo: 'Experimental',
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

/*
 * Preço da cena, em créditos do PikPok, derivado do custo real do modelo.
 *
 * Cena sem pessoa e cena "apresentador com produto" compõem um frame antes de
 * animar (nano-banana, ~2 créditos do plano); entra na conta porque é custo
 * de verdade. O arredondamento acontece UMA vez, sobre a soma, para não
 * inflar o preço duas vezes.
 *
 * Modelo fora do catálogo (env apontando para algo que não conhecemos) cai no
 * preço fixo de `ACTION_PRICES.video`: é o teto antigo, e errar para cima é o
 * lado seguro.
 */
const FRAME_CUSTO_PLANO = 2;

export function creditosDoModelo(modelo: ModeloDeVideo, comFrame = false): number {
  const custoPlano = modelo.custoPlano + (comFrame ? FRAME_CUSTO_PLANO : 0);
  return creditosPorCustoBrl(custoPlano * HIGGSFIELD_PLAN_CREDIT_BRL);
}

/** A cena compõe um frame com referências antes de animar? */
export function cenaComFrame(tipo: SceneKind): boolean {
  return cenaSemPessoa(tipo) || tipo === 'apresentador_produto';
}

/**
 * Quanto ESTA cena custa ao renderizar, já resolvendo o modelo (forçado na
 * cena ou o padrão do perfil). É a única fonte do número que a tela mostra e
 * que o billing cobra — os dois precisam bater.
 */
export function creditosDaCena(
  cena: { tipo: SceneKind; modoAudio: SceneAudioMode; modelo?: string | null },
  opts: { comoUsa?: string | null; env?: Record<string, string | undefined> } = {},
): number {
  const perfil = perfilDaCena({ tipo: cena.tipo, modoAudio: cena.modoAudio, comoUsa: opts.comoUsa });
  const modelo = modeloDeVideo(cena.modelo ?? modeloPadraoPorPerfil(perfil, opts.env));
  if (!modelo) return ACTION_PRICES.video.credits;
  return creditosDoModelo(modelo, cenaComFrame(cena.tipo));
}

/**
 * Opções que a tela mostra, com o padrão de cada perfil já resolvido. O que
 * sai daqui é o preço em créditos do PikPok — nunca o `custoPlano`, que é o
 * nosso custo na fornecedora, não o preço do cliente.
 */
export function catalogoDeModelos(env: Record<string, string | undefined> = process.env) {
  const perfis: PerfilDeCena[] = ['apresentador_fala', 'apresentador_mudo', 'tela', 'produto'];
  return {
    modelos: MODELOS_DE_VIDEO.map((m) => ({
      id: m.id,
      // O rótulo neutro, de propósito: a tela não cita qual IA gera.
      label: m.rotulo,
      falaPtBr: m.falaPtBr,
      creditos: creditosDoModelo(m),
      /** Com o frame composto (cena sem pessoa / apresentador com produto). */
      creditosComFrame: creditosDoModelo(m, true),
    })),
    padrao: Object.fromEntries(perfis.map((p) => [p, modeloPadraoPorPerfil(p, env)])) as Record<
      PerfilDeCena,
      string
    >,
  };
}
