import { ClipRole } from './entities/combination-clip.entity';

/**
 * Quanto tempo cada bloco deve durar.
 *
 * A fórmula que circula entre os vendedores de TikTok Shop é 3s de gancho, 10s
 * de desenvolvimento e 5s de CTA — ~18s no total. Não é superstição: os 3
 * primeiros segundos decidem se o vídeo é servido, e um vídeo de ~20s é o que
 * consegue retenção alta o bastante para o algoritmo continuar entregando.
 *
 * Aqui isso deixa de ser conselho e vira medida. O clipe é medido no upload, e
 * o vendedor vê o número ANTES de montar — porque no Multiplicador um gancho
 * arrastado de 12s não estraga um vídeo, estraga os 15 que dependem dele.
 *
 * Duas faixas por bloco, de propósito:
 *
 * - `ideal` é o alvo. Fora dela a tela avisa, mas a montagem acontece: um
 *   gancho de 4,2s pode ser ótimo, e travar o trabalho do cliente por causa de
 *   1,2s seria a ferramenta achando que sabe mais que ele.
 * - `limite` é o teto duro. Acima dele não é mais variação de estilo, é o
 *   clipe errado no bloco errado (o vídeo inteiro subido como "gancho") — e aí
 *   montar 150 combinações é gastar crédito e CPU para produzir 150 erros.
 */
export interface FaixaDeDuracao {
  /** Segundos do alvo da fórmula — é o número que a tela mostra como meta. */
  alvo: number;
  ideal: { min: number; max: number };
  /** Acima disto a montagem é recusada. */
  limite: number;
}

export const FAIXAS: Record<ClipRole, FaixaDeDuracao> = {
  hook: { alvo: 3, ideal: { min: 1.5, max: 5 }, limite: 8 },
  body: { alvo: 10, ideal: { min: 5, max: 15 }, limite: 25 },
  cta: { alvo: 5, ideal: { min: 2, max: 8 }, limite: 12 },
};

/** Como um clipe se comporta em relação à faixa do bloco dele. */
export type SituacaoDeDuracao = 'ideal' | 'fora-da-faixa' | 'acima-do-limite' | 'desconhecida';

/**
 * Classifica a duração medida.
 *
 * `0` significa "não foi possível medir" (ffmpeg ausente no ambiente, ou um
 * container que o ffprobe não leu) e nunca vira bloqueio: o vendedor não pode
 * ficar impedido de montar porque a NOSSA medição falhou.
 */
export function situacao(role: ClipRole, durationMs: number): SituacaoDeDuracao {
  if (!durationMs) return 'desconhecida';
  const s = durationMs / 1000;
  const faixa = FAIXAS[role];
  if (s > faixa.limite) return 'acima-do-limite';
  if (s < faixa.ideal.min || s > faixa.ideal.max) return 'fora-da-faixa';
  return 'ideal';
}
