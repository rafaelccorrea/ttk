import { BadRequestException } from '@nestjs/common';

/**
 * Moderação de conteúdo dos textos que o USUÁRIO digita e que alimentam a IA.
 *
 * Por que existe: o nome do produto, o benefício, a fala e a ação visual
 * entram direto nos prompts de roteiro e de geração de vídeo. Sem este filtro,
 * a única defesa era a recusa NSFW da fornecedora — que acontece DEPOIS da
 * cobrança (com estorno, mas com espera e frustração) e não cobre texto que só
 * vira roteiro. Aqui a recusa é imediata, de graça e com mensagem que explica.
 *
 * Por que lista de palavras e não um classificador de IA: o filtro roda em
 * TODO cadastro e TODA edição de cena — chamar um modelo a cada tecla de
 * formulário custaria mais que o roteiro em si e adicionaria segundos de
 * latência onde hoje há milissegundos. A lista pega o caso claro; o caso
 * ambíguo que escapar ainda encontra as regras de recusa nos prompts de
 * sistema e o NSFW da fornecedora. São três camadas de propósito.
 *
 * Falsos positivos importam tanto quanto falsos negativos: "sexta-feira" não
 * pode cair por conter "sexta". Por isso o casamento é por PALAVRA INTEIRA
 * sobre o texto normalizado (minúsculas, sem acento), nunca por substring.
 */

export type CategoriaBloqueada =
  | 'sexual'
  | 'drogas'
  | 'armas'
  | 'odio'
  | 'menores';

const MENSAGENS: Record<CategoriaBloqueada, string> = {
  sexual:
    'Conteúdo adulto não pode virar anúncio aqui — o TikTok Shop remove e pune a conta.',
  drogas:
    'Produtos relacionados a drogas não podem ser anunciados — o TikTok Shop proíbe e a conta é punida.',
  armas:
    'Armas e afins não podem ser anunciados — o TikTok Shop proíbe e a conta é punida.',
  odio: 'Esse texto contém termos ofensivos. Reescreva sem eles para continuar.',
  menores:
    'Conteúdo envolvendo menores nesse contexto é proibido. Este caso fica registrado.',
};

/*
 * As listas são pt-BR + inglês comum em gíria. Estão aqui no código, e não em
 * env/banco, de propósito: mudança de lista é mudança de política — deve
 * passar por revisão de código, não por edição silenciosa em produção.
 */
const LISTAS: Record<CategoriaBloqueada, string[]> = {
  sexual: [
    'porno',
    'pornografia',
    'pornografico',
    'pornografica',
    'xvideos',
    'onlyfans',
    'sexo explicito',
    'conteudo adulto',
    'acompanhante',
    'garota de programa',
    'garoto de programa',
    'prostituicao',
    'prostituta',
    'prostituto',
    'nude',
    'nudes',
    'masturbacao',
    'masturbador',
    'vibrador',
    'consolo sexual',
    'boneca sexual',
    'boneca inflavel',
    'fetiche sexual',
    'camgirl',
    'camboy',
    'striptease',
    'erotico',
    'erotica',
  ],
  drogas: [
    'cocaina',
    'crack',
    'heroina',
    'maconha',
    'skunk',
    'haxixe',
    'ecstasy',
    'mdma',
    'lsd',
    'lanca perfume',
    'anabolizante',
    'anabolizantes',
    'metanfetamina',
    'oxi',
    'k9',
    'k2 sintetico',
    'droga sintetica',
    'drogas sinteticas',
    'trafico de drogas',
    'seda para fumar',
    'bong',
    'narguile de maconha',
  ],
  armas: [
    // "pistola" sozinha não entra: pistola de cola quente, de pintura e de
    // pressão de água são produtos comuns e legítimos do TikTok Shop.
    'pistola 9mm',
    'pistola calibre',
    'revolver',
    'fuzil',
    'espingarda',
    'municao',
    'municoes',
    'silenciador de arma',
    'arma de fogo',
    'armas de fogo',
    'granada',
    'explosivo',
    'explosivos',
    'soco ingles',
    'canivete automatico',
  ],
  odio: [
    // Cobrimos os slurs inequívocos; xingamento comum não é caso de bloqueio,
    // é caso de roteiro ruim — e disso cuida o prompt.
    'viado de merda',
    'macaco imundo',
    'raca inferior',
    'heil hitler',
    'suastica',
  ],
  menores: [
    'crianca sensual',
    'menor de idade nua',
    'novinha pelada',
    'novinho pelado',
    'cp infantil',
  ],
};

/** Minúsculas e sem acento: "Cocaína" e "cocaina" são a mesma palavra. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

interface RegraCompilada {
  categoria: CategoriaBloqueada;
  regex: RegExp;
}

// Compiladas uma vez no load do módulo — o filtro roda em todo formulário.
const REGRAS: RegraCompilada[] = (
  Object.entries(LISTAS) as Array<[CategoriaBloqueada, string[]]>
).map(([categoria, termos]) => ({
  categoria,
  // \b não funciona com unicode fora do ASCII; delimitamos por "não-letra".
  regex: new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${termos
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})(?![\\p{L}\\p{N}])`,
    'iu',
  ),
}));

/** A categoria proibida encontrada, ou null se o texto está limpo. */
export function avaliarConteudo(texto: string): CategoriaBloqueada | null {
  const limpo = normalizar(texto);
  for (const regra of REGRAS) {
    if (regra.regex.test(limpo)) return regra.categoria;
  }
  return null;
}

/**
 * Valida um conjunto de campos de formulário de uma vez.
 *
 * Lança `BadRequestException` com mensagem amigável — o interceptor de erros
 * do frontend já a exibe como veio, então a mensagem É a experiência.
 */
export function garantirConteudoPermitido(
  campos: Record<string, string | null | undefined>,
): void {
  for (const [, valor] of Object.entries(campos)) {
    if (!valor) continue;
    const categoria = avaliarConteudo(valor);
    if (categoria) {
      throw new BadRequestException(MENSAGENS[categoria]);
    }
  }
}
