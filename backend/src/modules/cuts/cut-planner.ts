/**
 * Planejamento dos cortes — só aritmética, sem ffmpeg, sem IA, sem banco.
 *
 * Separado do serviço para ser testável de verdade: o serviço orquestra
 * (upload, cobrança, ffmpeg, S3); aqui mora a única parte que tem regra de
 * negócio própria — de que segundo a que segundo cada corte vai.
 */

export type CutMode = 'rapido' | 'inteligente';
export type CutFormat = '9:16' | '16:9' | '1:1';

/** Perfis da legenda queimada — espelhados na tela (`ESTILOS_DE_LEGENDA`). */
export const CAPTION_STYLES = ['classico', 'karaoke', 'impacto', 'minimal', 'oferta'] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

/** Como enquadrar fonte mais larga que o formato pedido. */
export const REFRAME_MODES = ['rosto', 'blur'] as const;
export type ReframeMode = (typeof REFRAME_MODES)[number];

export interface Trecho {
  inicio: number;
  fim: number;
}

export interface TrechoPlanejado extends Trecho {
  title: string | null;
  hook: string | null;
  reason: string | null;
  /** Nota 0–10 da IA; nula no modo rápido. */
  score: number | null;
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
 * Modo rápido: `quantidade` janelas espalhadas pela parte LIVRE da fonte.
 *
 * Espalhar (em vez de encavalar do início) é decisão de produto: um review de
 * 20 min tem começo, meio e fim, e cortes só dos primeiros 5 minutos entregam
 * o mesmo assunto 10 vezes. A fonte é dividida nos espaços entre os trechos a
 * `evitar` (os que a IA já escolheu); cada espaço recebe janelas na proporção
 * do seu tamanho, em grade uniforme, sem sobreposição.
 *
 * O alvo de duração é o meio da faixa, e encolhe até o mínimo quando a fonte
 * é curta para o pedido: 6 cortes de 30–60 s em 2:30 não cabem com 45 s (só
 * 3), mas cabem 5 de 30 s. Cada borda é puxada para o silêncio mais próximo
 * (até `folga` segundos), sem sair da faixa nem do espaço livre.
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
  const folga = Math.max(0, (maxSeg - minSeg) / 2);
  const espacos = espacosLivres(duracaoFonte, evitar);
  const livre = espacos.reduce((s, e) => s + (e.fim - e.inicio), 0);
  if (livre <= 0) return [];
  const alvo = Math.min(duracaoAlvo(minSeg, maxSeg), Math.max(minSeg, livre / n), duracaoFonte);

  const resultado: TrechoPlanejado[] = [];
  // Quantas janelas cabem em cada espaço, e quantas ele merece pelo tamanho.
  const cotas = espacos.map((e) => {
    const tamanho = e.fim - e.inicio;
    const cabem = Math.floor(tamanho / Math.min(alvo, minSeg + 0.0001) + 1e-9);
    const merece = Math.round((tamanho / livre) * n);
    return { espaco: e, tamanho, quer: Math.min(cabem, Math.max(merece, tamanho >= minSeg ? 1 : 0)) };
  });
  // Ajusta a soma das cotas para n (sobra vai para os espaços com folga).
  let soma = cotas.reduce((s, c) => s + c.quer, 0);
  for (const c of cotas.sort((a, b) => b.tamanho - a.tamanho)) {
    if (soma >= n) break;
    const cabem = Math.floor(c.tamanho / minSeg + 1e-9);
    const extra = Math.min(n - soma, Math.max(0, cabem - c.quer));
    c.quer += extra;
    soma += extra;
  }
  for (const c of cotas.sort((a, b) => b.quer - a.quer)) {
    if (soma <= n) break;
    const tira = Math.min(soma - n, c.quer);
    c.quer -= tira;
    soma -= tira;
  }
  cotas.sort((a, b) => a.espaco.inicio - b.espaco.inicio);

  for (const { espaco, tamanho, quer } of cotas) {
    if (quer <= 0) continue;
    // Duração por janela neste espaço: o alvo, ou menos se for preciso caber.
    const dur = Math.max(minSeg, Math.min(alvo, tamanho / quer));
    const passo = quer > 1 ? (tamanho - dur) / (quer - 1) : 0;
    for (let i = 0; i < quer; i += 1) {
      const inicioBruto = espaco.inicio + i * passo;
      let inicio = ajustarAoSilencio(inicioBruto, silencios, folga);
      inicio = Math.max(espaco.inicio, Math.min(inicio, espaco.fim - minSeg));
      let fim = ajustarAoSilencio(inicio + dur, silencios, folga);
      fim = Math.max(inicio + minSeg, Math.min(fim, inicio + maxSeg, espaco.fim));
      if (fim - inicio < minSeg - 0.01) {
        inicio = Math.max(espaco.inicio, fim - minSeg);
        if (fim - inicio < minSeg - 0.01) continue;
      }
      const trecho = { inicio: arred(inicio), fim: arred(fim) };
      if (sobrepoe(trecho, resultado) || sobrepoe(trecho, evitar)) continue;
      resultado.push({
        ...trecho,
        title: null,
        hook: null,
        reason: null,
        score: null,
        origem: 'rapido',
      });
    }
  }
  return resultado.slice(0, n);
}

/** Os intervalos de `[0, duracao]` que não tocam nenhum trecho de `evitar`. */
export function espacosLivres(duracao: number, evitar: Trecho[]): Trecho[] {
  const ocupados = [...evitar]
    .map((t) => ({ inicio: Math.max(0, t.inicio), fim: Math.min(duracao, t.fim) }))
    .filter((t) => t.fim > t.inicio)
    .sort((a, b) => a.inicio - b.inicio);
  const livres: Trecho[] = [];
  let cursor = 0;
  for (const o of ocupados) {
    if (o.inicio > cursor) livres.push({ inicio: cursor, fim: o.inicio });
    cursor = Math.max(cursor, o.fim);
  }
  if (duracao > cursor) livres.push({ inicio: cursor, fim: duracao });
  return livres;
}

/** Sugestão crua vinda da IA — nada aqui é confiável até `validarSugestoes`. */
export interface SugestaoDaIa {
  inicio: unknown;
  fim: unknown;
  titulo?: unknown;
  gancho?: unknown;
  motivo?: unknown;
  score?: unknown;
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
      score: nota(s.score),
      origem: 'ia',
    });
  }
  return aceitos;
}

/** Nota da IA saneada para 0–10 inteiro; qualquer coisa estranha vira nula. */
function nota(valor: unknown): number | null {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/**
 * Preço do job em créditos, ANTES de saber a duração real (cotação) ou depois.
 * `transcribeBlocks` só existe no modo inteligente.
 */
export function blocosDeTranscricao(duracaoSeg: number, blocoMin: number): number {
  return Math.max(1, Math.ceil(duracaoSeg / (blocoMin * 60)));
}

/** Uma palavra com tempo absoluto na fonte (só quando o Whisper devolveu). */
export interface PalavraDeFala {
  inicio: number;
  fim: number;
  texto: string;
}

/** Um segmento de fala com tempo absoluto na fonte. */
export interface SegmentoDeFala {
  inicio: number;
  fim: number;
  texto: string;
  /** Palavras com tempo — o que o estilo karaokê precisa. Ausente = sem karaokê. */
  palavras?: PalavraDeFala[];
}

/**
 * O SRT de um corte: só os segmentos que tocam `[inicio, fim]`, com os tempos
 * deslocados para o zero do corte e recortados nas bordas. Devolve string
 * vazia quando não há fala no trecho — o chamador então não queima nada.
 *
 * Cada segmento é FATIADO em cues de no máximo duas linhas curtas, com o
 * tempo repartido em proporção ao texto. Um segmento do Whisper costuma ser a
 * frase inteira (60–120 caracteres); queimado de uma vez com a fonte grande do
 * 9:16, o libass re-quebrava a "segunda linha" em mais cinco e o bloco cobria
 * o rosto de quem fala.
 */
export function srtDoTrecho(
  segmentos: SegmentoDeFala[],
  inicio: number,
  fim: number,
  estilo: CaptionStyle = 'classico',
): string {
  const blocos: string[] = [];
  let n = 0;
  const cue = (a: number, b: number, texto: string) => {
    n += 1;
    blocos.push(`${n}\n${tempoSrt(a)} --> ${tempoSrt(b)}\n${texto}\n`);
  };
  for (const s of segmentos) {
    if (s.fim <= inicio || s.inicio >= fim) continue;
    const texto = s.texto.replace(/\s+/g, ' ').trim();
    if (!texto) continue;
    const a = Math.max(0, s.inicio - inicio);
    const b = Math.max(a + 0.3, Math.min(fim, s.fim) - inicio);

    if (estilo === 'karaoke' && s.palavras?.length) {
      cuesKaraoke(s.palavras, inicio, a, b, cue);
      continue;
    }

    const fatias = fatiar(texto, MAX_POR_CUE);
    const totalChars = fatias.reduce((acc, f) => acc + f.length, 0);
    let cursor = a;
    fatias.forEach((fatia, i) => {
      const ultima = i === fatias.length - 1;
      const dur = ((b - a) * fatia.length) / totalChars;
      const fimCue = ultima ? b : Math.min(b, Math.max(cursor + 0.3, cursor + dur));
      cue(cursor, fimCue, decorar(quebrar(fatia), estilo));
      cursor = fimCue;
    });
  }
  return blocos.join('\n');
}

/** Cor de destaque (palavra ativa no karaokê, preço na oferta). */
const COR_DESTAQUE = '#FFD500';

/**
 * Karaokê: a mesma fatia de ≤ 2 linhas, mas um cue POR PALAVRA, com a palavra
 * falada naquele instante em destaque. O libass entende `<font color>` em SRT,
 * então não precisa de ASS. A fatia é montada a partir das palavras com tempo
 * (não do texto do segmento) para o destaque bater com o áudio.
 */
function cuesKaraoke(
  palavras: PalavraDeFala[],
  offset: number,
  a: number,
  b: number,
  cue: (a: number, b: number, texto: string) => void,
): void {
  const grupos: PalavraDeFala[][] = [];
  let atual: PalavraDeFala[] = [];
  let chars = 0;
  for (const p of palavras) {
    const t = p.texto.trim();
    if (!t) continue;
    if (chars + t.length + (atual.length ? 1 : 0) > MAX_POR_CUE && atual.length) {
      grupos.push(atual);
      atual = [];
      chars = 0;
    }
    atual.push({ ...p, texto: t });
    chars += t.length + (atual.length > 1 ? 1 : 0);
  }
  if (atual.length) grupos.push(atual);

  for (const grupo of grupos) {
    const linhas = linhasDePalavras(grupo.map((p) => p.texto));
    const fimGrupo = Math.min(b, Math.max(a, grupo[grupo.length - 1].fim - offset));
    grupo.forEach((p, i) => {
      const ini = Math.max(a, Math.min(b, p.inicio - offset));
      const proximo = grupo[i + 1];
      const fimCue = proximo ? Math.max(ini + 0.05, proximo.inicio - offset) : fimGrupo;
      if (fimCue <= ini) return;
      const texto = linhas
        .map((linha) =>
          linha
            .map((idx) =>
              idx === i ? `<font color="${COR_DESTAQUE}">${grupo[idx].texto}</font>` : grupo[idx].texto,
            )
            .join(' '),
        )
        .join('\n');
      cue(ini, Math.min(b, fimCue), texto);
    });
  }
}

/** Índices das palavras por linha (≤ 2 linhas, tamanhos parecidos). */
function linhasDePalavras(palavras: string[]): number[][] {
  const total = palavras.join(' ').length;
  if (total <= MAX_POR_LINHA) return [palavras.map((_, i) => i)];
  const alvo = Math.ceil(total / 2);
  const primeira: number[] = [];
  let len = 0;
  for (let i = 0; i < palavras.length; i += 1) {
    const novo = len + palavras[i].length + (primeira.length ? 1 : 0);
    if (novo > alvo && primeira.length) break;
    primeira.push(i);
    len = novo;
  }
  const segunda = palavras.map((_, i) => i).filter((i) => !primeira.includes(i));
  return segunda.length ? [primeira, segunda] : [primeira];
}

/** Preços e percentuais: o que o estilo "oferta" põe em destaque. */
const PRECO = /(R\$\s?\d[\d.,]*|\d[\d.,]*\s?(?:reais|%)|\d+\s?x\s?de\s?R?\$?\s?\d[\d.,]*)/gi;

/** Ajustes de texto por estilo: caixa alta no impacto/oferta, preço em destaque na oferta. */
function decorar(texto: string, estilo: CaptionStyle): string {
  if (estilo === 'impacto') return texto.toUpperCase();
  if (estilo === 'oferta') {
    return texto
      .toUpperCase()
      .replace(PRECO, (m) => `<font color="${COR_DESTAQUE}">${m}</font>`);
  }
  return texto;
}

/** Largura de uma linha: em 720 px com a fonte do corte cabem ~26 letras. */
const MAX_POR_LINHA = 26;
/** Duas linhas por cue — o que se lê de relance sem tapar o vídeo. */
const MAX_POR_CUE = MAX_POR_LINHA * 2;

/** Parte o texto em pedaços de até `max` caracteres, sem cortar palavra. */
function fatiar(texto: string, max: number): string[] {
  const pedacos: string[] = [];
  let atual = '';
  for (const p of texto.split(' ')) {
    if ((atual + ' ' + p).trim().length > max && atual) {
      pedacos.push(atual);
      atual = p;
    } else {
      atual = (atual + ' ' + p).trim();
    }
  }
  if (atual) pedacos.push(atual);
  return pedacos;
}

function tempoSrt(seg: number): string {
  const ms = Math.round(seg * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (v: number, l = 2) => String(v).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/** Quebra uma fatia (≤ 2 linhas de `max`) em linhas de tamanho parecido. */
function quebrar(texto: string, max = MAX_POR_LINHA): string {
  if (texto.length <= max) return texto;
  const linhas = fatiar(texto, Math.max(max, Math.ceil(texto.length / 2)));
  // No máximo duas linhas por bloco: acima disso tapa o vídeo.
  return linhas.length <= 2 ? linhas.join('\n') : `${linhas[0]}\n${linhas.slice(1).join(' ')}`;
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
