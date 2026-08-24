/**
 * Planejamento dos cortes — só aritmética, sem ffmpeg, sem IA, sem banco.
 *
 * Separado do serviço para ser testável de verdade: o serviço orquestra
 * (upload, cobrança, ffmpeg, S3); aqui mora a única parte que tem regra de
 * negócio própria — de que segundo a que segundo cada corte vai.
 */

export type CutMode = 'rapido' | 'inteligente';
export type CutFormat = '9:16' | '16:9' | '1:1';

export interface Trecho {
  inicio: number;
  fim: number;
}

export interface TrechoPlanejado extends Trecho {
  title: string | null;
  hook: string | null;
  reason: string | null;
  /** De onde veio: escolhido pela IA ou preenchido pelo modo rápido. */
  origem: 'ia' | 'rapido';
}

export interface Silencio {
  inicio: number;
  fim: number;
}

/** Limites do produto — espelhados na tela e no DTO. */
export const LIMITES = {
  fonteMinSeg: 2 * 60,
  fonteMaxSeg: 60 * 60,
  qtdMin: 3,
  qtdMax: 20,
  corteMinSeg: 15,
  corteMaxSeg: 90,
} as const;

/** Duração alvo de um corte dada a faixa: o meio, que é o que "parece certo". */
export function duracaoAlvo(minSeg: number, maxSeg: number): number {
  return (minSeg + maxSeg) / 2;
}

/**
 * Onde cortar sem decepar frase: o meio do silêncio mais próximo de `alvo`
 * dentro de `[alvo - folga, alvo + folga]`; sem silêncio ali, o próprio alvo.
 */
export function ajustarAoSilencio(
  alvo: number,
  silencios: Silencio[],
  folga: number,
): number {
  let melhor: number | null = null;
  let distancia = Infinity;
  for (const s of silencios) {
    const meio = (s.inicio + s.fim) / 2;
    const d = Math.abs(meio - alvo);
    if (d <= folga && d < distancia) {
      melhor = meio;
      distancia = d;
    }
  }
  return melhor ?? alvo;
}

/**
 * Modo rápido: `quantidade` janelas espalhadas pela fonte inteira.
 *
 * Espalhar (em vez de encavalar do início) é decisão de produto: um review de
 * 20 min tem começo, meio e fim, e cortes só dos primeiros 5 minutos entregam
 * o mesmo assunto 10 vezes. O passo entre janelas é (duração − alvo) / (n − 1),
 * então o primeiro corte começa em 0 e o último termina no fim.
 *
 * Cada borda é puxada para o silêncio mais próximo (até `folga` segundos),
 * respeitando a faixa [min, max] do corte. Se a fonte é curta demais para
 * `quantidade` janelas sem sobreposição, as janelas se sobrepõem — é o que o
 * usuário pediu; ele vê a faixa de tempo de cada corte na tela.
 */
export function planejarRapido(
  duracaoFonte: number,
  quantidade: number,
  minSeg: number,
  maxSeg: number,
  silencios: Silencio[] = [],
  evitar: Trecho[] = [],
): TrechoPlanejado[] {
  const n = Math.max(1, Math.trunc(quantidade));
  const alvo = Math.min(duracaoAlvo(minSeg, maxSeg), duracaoFonte);
  const folga = Math.max(0, (maxSeg - minSeg) / 2);
  // A grade tem uma vaga para cada trecho a evitar (os que a IA já escolheu):
  // a vaga que cair em cima de um deles é descartada e as outras preenchem.
  const vagas = n + evitar.length;
  const passo = vagas > 1 ? Math.max(0, (duracaoFonte - alvo) / (vagas - 1)) : 0;

  const resultado: TrechoPlanejado[] = [];
  for (let i = 0; resultado.length < n && i < vagas; i += 1) {
    const inicioBruto = Math.min(i * passo, Math.max(0, duracaoFonte - alvo));
    let inicio = ajustarAoSilencio(inicioBruto, silencios, folga);
    inicio = Math.max(0, Math.min(inicio, Math.max(0, duracaoFonte - minSeg)));

    let fim = ajustarAoSilencio(inicio + alvo, silencios, folga);
    fim = Math.max(inicio + minSeg, Math.min(fim, inicio + maxSeg, duracaoFonte));
    if (fim - inicio < minSeg) {
      // Fonte acabou antes do mínimo: recua o início para caber.
      inicio = Math.max(0, fim - minSeg);
    }
    if (fim - inicio < Math.min(minSeg, duracaoFonte) - 0.01) break;

    const trecho = { inicio: arred(inicio), fim: arred(fim) };
    if (sobrepoe(trecho, evitar) || sobrepoe(trecho, resultado)) {
      if (i * passo > duracaoFonte) break;
      continue;
    }
    resultado.push({ ...trecho, title: null, hook: null, reason: null, origem: 'rapido' });
  }
  return resultado;
}

/** Sugestão crua vinda da IA — nada aqui é confiável até `validarSugestoes`. */
export interface SugestaoDaIa {
  inicio: unknown;
  fim: unknown;
  titulo?: unknown;
  gancho?: unknown;
  motivo?: unknown;
}

/**
 * O que a IA devolve passa pelo mesmo crivo que qualquer entrada de usuário.
 *
 * Trecho fora da fonte, invertido, fora da faixa [min, max] ou sobreposto a
 * outro já aceito é descartado — não "consertado". Um corte que a IA quis com
 * 200 s e nós encurtamos para 90 s perde o final que justificava o corte;
 * melhor deixar o modo rápido preencher a vaga com uma janela honesta.
 * Ordem de aceitação = ordem da IA (ela devolve do melhor para o pior).
 */
export function validarSugestoes(
  sugestoes: SugestaoDaIa[],
  duracaoFonte: number,
  quantidade: number,
  minSeg: number,
  maxSeg: number,
): TrechoPlanejado[] {
  const aceitos: TrechoPlanejado[] = [];
  const tolerancia = 0.15; // 15% de folga: a IA arredonda pelo segmento do Whisper
  for (const s of sugestoes) {
    if (aceitos.length >= quantidade) break;
    const inicio = Number(s.inicio);
    const fim = Number(s.fim);
    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) continue;
    if (inicio < 0 || fim > duracaoFonte + 0.5 || fim <= inicio) continue;
    const dur = fim - inicio;
    if (dur < minSeg * (1 - tolerancia) || dur > maxSeg * (1 + tolerancia)) continue;
    const trecho = {
      inicio: arred(Math.max(0, inicio)),
      fim: arred(Math.min(duracaoFonte, fim)),
    };
    if (sobrepoe(trecho, aceitos)) continue;
    aceitos.push({
      ...trecho,
      title: texto(s.titulo, 80),
      hook: texto(s.gancho, 200),
      reason: texto(s.motivo, 200),
      origem: 'ia',
    });
  }
  return aceitos;
}

/**
 * Preço do job em créditos, ANTES de saber a duração real (cotação) ou depois.
 * `transcribeBlocks` só existe no modo inteligente.
 */
export function blocosDeTranscricao(duracaoSeg: number, blocoMin: number): number {
  return Math.max(1, Math.ceil(duracaoSeg / (blocoMin * 60)));
}

export function sobrepoe(t: Trecho, outros: Trecho[]): boolean {
  return outros.some((o) => t.inicio < o.fim && o.inicio < t.fim);
}

function arred(n: number): number {
  return Math.round(n * 100) / 100;
}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/\s+/g, ' ').trim();
  return limpo ? limpo.slice(0, max) : null;
}
