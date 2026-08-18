/**
 * Preço de tabela dos modelos que a plataforma usa, em USD por milhão de
 * tokens.
 *
 * Existe para responder uma pergunta que nenhuma estimativa responde: quanto a
 * IA custou DE VERDADE ontem. Toda a tabela de créditos do `billing.config` é
 * construída sobre custos de pior caso calculados à mão — e pior caso calculado
 * à mão envelhece: o preço do fornecedor muda, o prompt engorda, o cache pega
 * menos do que se imaginava. Sem medir, a primeira notícia de que a margem
 * virou prejuízo é a fatura.
 *
 * O câmbio é conservador e o mesmo do `billing.config`, de propósito: se os
 * dois divergirem, a margem medida aqui não fala da margem precificada lá.
 */

export const USD_BRL = 6.0;

export interface ModelPricing {
  /** USD por milhão de tokens de entrada. */
  input: number;
  /** USD por milhão de tokens de saída. */
  output: number;
  /** Leitura de cache: uma fração do preço de entrada. */
  cacheRead: number;
  /** Escrita de cache com TTL de 1h. */
  cacheWrite: number;
}

/**
 * Modelo desconhecido não pode custar zero: um custo silenciosamente ausente é
 * pior que um custo errado, porque some do relatório em vez de gritar. Quando
 * alguém trocar o modelo sem passar por aqui, o fallback cobra caro e a linha
 * aparece no topo da lista de custos — que é onde ela precisa aparecer.
 */
export const FALLBACK_PRICING: ModelPricing = {
  input: 5,
  output: 25,
  cacheRead: 0.5,
  cacheWrite: 10,
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 },
};

/** Whisper cobra por minuto de áudio, não por token: USD 0,006/min. */
export const WHISPER_USD_PER_MINUTE = 0.006;

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Casa o nome que a API devolve (com data no fim) com a tabela de preços. */
export function pricingFor(model: string): ModelPricing {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  const base = Object.keys(MODEL_PRICING).find((m) => model.startsWith(m));
  return base ? MODEL_PRICING[base] : FALLBACK_PRICING;
}

/** Custo em BRL de uma chamada, a partir do que a API reportou de uso. */
export function costBrl(model: string, usage: TokenUsage): number {
  const p = pricingFor(model);
  const usd =
    ((usage.inputTokens ?? 0) * p.input +
      (usage.outputTokens ?? 0) * p.output +
      (usage.cacheReadTokens ?? 0) * p.cacheRead +
      (usage.cacheWriteTokens ?? 0) * p.cacheWrite) /
    1_000_000;
  return usd * USD_BRL;
}

/** Custo em BRL de uma transcrição, pelo tempo real do áudio. */
export function whisperCostBrl(durationSeconds: number): number {
  return (durationSeconds / 60) * WHISPER_USD_PER_MINUTE * USD_BRL;
}
