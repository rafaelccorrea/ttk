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

/**
 * `cacheWrite` é zero nos modelos da OpenAI e isso não é omissão.
 *
 * A Anthropic cobra para GRAVAR o prefixo no cache (com TTL escolhido por nós)
 * e devolve `cache_creation_input_tokens` para essa gravação. A OpenAI cacheia
 * sozinha, não cobra pela gravação e não reporta campo equivalente — o desconto
 * aparece só na leitura. Um preço de escrita aqui multiplicaria um contador que
 * a API nunca preenche, e o único efeito seria fingir um custo que não existe.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI — em uso.
  'gpt-5.4': { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
  'gpt-5.5': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },

  /*
   * Claude — fora de uso desde a migração para a OpenAI, mantido porque a
   * telemetria é histórica: os eventos gravados antes da troca continuam no
   * banco e um relatório dos últimos 90 dias ainda os lê. Remover estas linhas
   * não apagaria as chamadas passadas, só as reprecificaria pelo FALLBACK.
   */
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

/**
 * Casa o nome que a API devolve (com data no fim) com a tabela de preços.
 *
 * O prefixo tem que ser o MAIS LONGO que casa, não o primeiro encontrado:
 * `gpt-5.4-mini-2026-03-17` começa com `gpt-5.4` e com `gpt-5.4-mini`, e pegar
 * o primeiro faria o modelo barato ser cobrado pela tabela do caro — errado por
 * 3,3x, silenciosamente, e justo no modelo que roda com mais frequência.
 */
export function pricingFor(model: string): ModelPricing {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  const base = Object.keys(MODEL_PRICING)
    .filter((m) => model.startsWith(m))
    .sort((a, b) => b.length - a.length)[0];
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
