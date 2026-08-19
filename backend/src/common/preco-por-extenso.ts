/**
 * Preço em palavras, em pt-BR — determinístico, sem depender do modelo.
 *
 * "R$ 10" saiu falado como dólar em produção; "10 reais" ainda deixava o
 * número em dígito, e o modelo de vídeo/TTS erra a leitura de algarismo com
 * frequência. Escrever "dez reais" no texto do áudio elimina a classe inteira
 * de erro. A legenda queimada continua usando o texto original com dígitos —
 * "R$ 10" lê melhor na tela do que por extenso.
 */

const UNIDADES = [
  'zero',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

function ate999(n: number): string {
  if (n === 100) return 'cem';
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (centena) partes.push(CENTENAS[centena]);
  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const dezena = Math.floor(resto / 10);
      const unidade = resto % 10;
      partes.push(unidade ? `${DEZENAS[dezena]} e ${UNIDADES[unidade]}` : DEZENAS[dezena]);
    }
  }
  return partes.join(' e ');
}

/** Inteiro em palavras, até 999.999 — teto de preço da plataforma coberto. */
export function numeroPorExtenso(n: number): string {
  const inteiro = Math.floor(Math.abs(n));
  if (inteiro === 0) return 'zero';
  const milhares = Math.floor(inteiro / 1000);
  const resto = inteiro % 1000;
  const partes: string[] = [];
  if (milhares === 1) partes.push('mil');
  else if (milhares) partes.push(`${ate999(milhares)} mil`);
  if (resto) {
    // "mil E dez", "dois mil E quinhentos" — mas "mil duzentos e trinta".
    const conector = milhares && (resto < 100 || resto % 100 === 0) ? 'e ' : '';
    partes.push(`${conector}${ate999(resto)}`);
  }
  return partes.join(' ');
}

/** "29.9" → "vinte e nove reais e noventa centavos". */
export function precoPorExtenso(valor: number): string {
  const reais = Math.floor(valor);
  const centavos = Math.round((valor - reais) * 100);
  const parteReais = reais === 1 ? 'um real' : `${numeroPorExtenso(reais)} reais`;
  if (!centavos) return parteReais;
  const parteCentavos =
    centavos === 1 ? 'um centavo' : `${numeroPorExtenso(centavos)} centavos`;
  return reais ? `${parteReais} e ${parteCentavos}` : parteCentavos;
}

/**
 * Troca todo preço escrito em dígito pelo extenso, cobrindo as três grafias
 * que aparecem nas falas: "R$ 29,90", "29,90 reais" e "29 reais".
 */
export function precosPorExtensoNoTexto(texto: string): string {
  const converter = (reais: string, centavos?: string) =>
    precoPorExtenso(
      parseInt(reais, 10) +
        (centavos ? Number(`0.${centavos.padEnd(2, '0')}`) : 0),
    );
  return texto
    .replace(/R\$\s*(\d+)(?:[.,](\d{1,2}))?(?!\d)/g, (_, r, c) => converter(r, c))
    .replace(/(\d+)(?:[.,](\d{1,2}))?\s*rea(?:is|l)\b/gi, (_, r, c) =>
      `${converter(r, c)}`,
    );
}
