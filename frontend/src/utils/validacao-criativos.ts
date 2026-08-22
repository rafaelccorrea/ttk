/**
 * Regras dos formulários da Fábrica de Criativos.
 *
 * Os limites são os MESMOS dos DTOs do backend (`campaigns.dto.ts`), de
 * propósito: quando divergem, o usuário escreve 600 caracteres, clica em
 * salvar e leva um 400 genérico depois de perder o texto. Aqui ele vê o
 * contador estourar enquanto digita.
 *
 * Validar no cliente não substitui validar no servidor — o servidor continua
 * sendo a autoridade, porque qualquer um pode chamar a API direto. Isto aqui é
 * sobre não desperdiçar o tempo de quem está de boa-fé.
 */

export const LIMITES = {
  nomeProduto: 200,
  beneficio: 500,
  problema: 500,
  rotuloPersona: 60,
  /** 90 ≈ 12 palavras ditas com calma em 5s — o mesmo teto do servidor. */
  fala: 90,
  acaoVisual: 400,
  /** `Max(1_000_000)` no DTO. */
  precoMaximo: 1_000_000,
  fotoBytes: 8 * 1024 * 1024,
  fotosPorProduto: 5,
  /**
   * Piso de fotos para virar campanha. Cada cena de produto parte de uma foto
   * diferente: com uma só, as três cenas animam a MESMA imagem e o anúncio
   * denuncia a repetição. O backend cobra o mesmo piso em `criarCampanha`.
   */
  fotosMinimasPorProduto: 3,
} as const;

/** Duração de uma cena renderizada. */
const SEGUNDOS_POR_CENA = 5;

export type Erro = string | null;

export function validarNomeProduto(valor: string): Erro {
  const limpo = valor.trim();
  if (!limpo) return 'Informe o nome do produto.';
  if (limpo.length < 3) return 'O nome precisa ter ao menos 3 caracteres.';
  if (limpo.length > LIMITES.nomeProduto)
    return `Máximo de ${LIMITES.nomeProduto} caracteres.`;
  return null;
}

export function validarPreco(valor: number | null): Erro {
  if (valor === null) return null; // opcional — o roteiro funciona sem preço
  if (valor <= 0) return 'O preço precisa ser maior que zero.';
  if (valor > LIMITES.precoMaximo) return 'Preço acima do limite permitido.';
  return null;
}

export function validarTextoLongo(
  valor: string,
  limite: number,
  rotulo: string,
): Erro {
  if (valor.length > limite) return `${rotulo}: máximo de ${limite} caracteres.`;
  return null;
}

export function validarRotuloPersona(valor: string): Erro {
  if (valor.length > LIMITES.rotuloPersona)
    return `Máximo de ${LIMITES.rotuloPersona} caracteres.`;
  return null;
}

export function validarFala(valor: string): Erro {
  const limpo = valor.trim();
  if (!limpo) return 'A cena precisa de uma fala.';
  if (valor.length > LIMITES.fala) return `Máximo de ${LIMITES.fala} caracteres.`;
  return null;
}

/**
 * Menor lado aceitável de uma foto de produto, em pixels.
 *
 * A cena é renderizada em 1080×1920 A PARTIR desta foto: uma miniatura de
 * 200px vira um borrão em tela cheia, e o vendedor só descobre depois de
 * gastar os créditos da cena. 500px no menor lado é o piso em que a ampliação
 * ainda segura. 500 barrava foto vertical legítima de celular (ex.:
 * 365×547) — o piso real de usabilidade em 720p é ~300 no menor lado.
 */
export const FOTO_LADO_MINIMO = 300;

/**
 * Valida as DIMENSÕES da foto — assíncrona porque precisa decodificar.
 *
 * Complementa `validarFoto` (tipo/tamanho, síncrona): esta aqui pega o erro
 * que só aparece renderizando — a foto pequena demais para virar frame.
 * Arquivo que nem decodifica não é rejeitado aqui: o backend já recusa com
 * mensagem própria, e duplicar essa recusa criaria duas mensagens diferentes
 * para o mesmo problema.
 */
export async function validarDimensoesDaFoto(arquivo: File): Promise<Erro> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img) return null; // decodificação é problema do backend
    const menor = Math.min(img.naturalWidth, img.naturalHeight);
    if (menor < FOTO_LADO_MINIMO) {
      return `Foto muito pequena (${img.naturalWidth}×${img.naturalHeight}). Use ao menos ${FOTO_LADO_MINIMO}px no menor lado — é dela que sai o frame do vídeo.`;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Quanto tempo a fala leva para ser dita, estimado por caracteres.
 *
 * Caracteres aproximam sílabas — e sílaba é o que consome tempo — muito
 * melhor que contagem de palavras: "pra", "o", "e" não custam nada, e um
 * aviso por palavras marcava como longa uma fala de 4 segundos. O teto de
 * 90 caracteres (`LIMITES.fala`) É a regra de duração; aqui ela vira número.
 */
export function estimarSegundosDeFala(valor: string): number {
  return (valor.trim().length / LIMITES.fala) * SEGUNDOS_POR_CENA;
}

/** "~4,2 s de 5 s" — informa a duração sem contradizer o limite do campo. */
export function indicadorDeFala(valor: string): string {
  const s = estimarSegundosDeFala(valor);
  return `~${s.toFixed(1).replace('.', ',')} s de ${SEGUNDOS_POR_CENA} s`;
}

/**
 * Aviso, não erro: perto do teto a fala ainda cabe, mas sai corrida. Acima do
 * teto o campo já bloqueia — este é o último degrau antes dele.
 */
export function avisoFalaNoLimite(valor: string): Erro {
  if (valor.trim().length > LIMITES.fala * 0.9) {
    return `${indicadorDeFala(valor)} — no limite: o final pode sair corrido.`;
  }
  return null;
}

export function validarAcaoVisual(valor: string): Erro {
  const limpo = valor.trim();
  if (!limpo) return 'Descreva o que aparece na tela.';
  if (valor.length > LIMITES.acaoVisual)
    return `Máximo de ${LIMITES.acaoVisual} caracteres.`;
  return null;
}

/**
 * Checa a foto ANTES de subir. Sem isto, um arquivo de 30MB gasta o upload
 * inteiro para receber um 413, e um PDF renomeado para .jpg só é recusado
 * depois de atravessar a rede.
 */
export function validarFoto(arquivo: File): Erro {
  if (!arquivo.type.startsWith('image/'))
    return `"${arquivo.name}" não é uma imagem.`;
  if (arquivo.size > LIMITES.fotoBytes)
    return `"${arquivo.name}" tem ${(arquivo.size / 1024 / 1024).toFixed(1)}MB. O limite é 8MB.`;
  return null;
}

/** Texto do contador, que fica vermelho perto do limite. */
export function contador(valor: string, limite: number): string {
  return `${valor.length}/${limite}`;
}

export function perigoNoContador(valor: string, limite: number): boolean {
  return valor.length > limite * 0.9;
}
