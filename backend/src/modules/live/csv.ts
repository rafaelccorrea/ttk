/**
 * Leitura de CSV de catálogo, sem dependência nova.
 *
 * A tentação é `split(',')` e seguir a vida. Não funciona com o arquivo que o
 * cliente realmente manda: ele exporta do Excel em português, e o Excel em
 * português escreve `;` como separador (porque a vírgula já é o separador
 * decimal), põe BOM no começo do arquivo e envolve em aspas qualquer campo que
 * contenha o separador. Um `split` simples transforma "Kit Glow, 3 em 1" em duas
 * colunas e joga o preço para a coluna errada — sem erro nenhum, o que é pior:
 * o produto entra na base com preço de outro, e o copiloto passa a anunciar isso
 * ao vivo com toda a confiança.
 *
 * Então isto implementa o essencial do RFC 4180 mais os desvios do Excel:
 * detecção de separador, aspas com escape `""`, quebra de linha dentro de campo,
 * CRLF e BOM.
 */

/** Separadores candidatos, na ordem em que se costuma encontrá-los. */
const SEPARADORES = [';', ',', '\t'] as const;

/**
 * Descobre o separador contando ocorrências FORA de aspas na primeira linha.
 *
 * Contar no arquivo inteiro erraria: um catálogo com descrições cheias de
 * vírgula elegeria a vírgula mesmo num arquivo separado por ponto e vírgula. O
 * cabeçalho é a linha mais confiável — é a única que sabemos ter só nomes de
 * coluna.
 */
export function detectarSeparador(texto: string): string {
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? '';
  let melhor = ',';
  let maior = 0;
  for (const sep of SEPARADORES) {
    let contagem = 0;
    let dentroDeAspas = false;
    for (let i = 0; i < primeiraLinha.length; i++) {
      const c = primeiraLinha[i];
      if (c === '"') dentroDeAspas = !dentroDeAspas;
      else if (c === sep && !dentroDeAspas) contagem++;
    }
    if (contagem > maior) {
      maior = contagem;
      melhor = sep;
    }
  }
  return melhor;
}

/**
 * Quebra o CSV em matriz de células.
 *
 * Percorre caractere a caractere porque campo com quebra de linha dentro de
 * aspas — descrição de produto em duas linhas é comum — torna impossível
 * dividir por linha antes de entender as aspas.
 */
export function lerCsv(texto: string): string[][] {
  // O BOM do Excel vira parte do nome da primeira coluna se não sair aqui, e aí
  // o cabeçalho "nome" nunca casa e o arquivo inteiro é lido como sem nome.
  const limpo = texto.replace(/^\uFEFF/, '');
  const sep = detectarSeparador(limpo);

  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let dentroDeAspas = false;

  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];

    if (dentroDeAspas) {
      if (c === '"') {
        // `""` dentro de aspas é uma aspa literal, não o fim do campo.
        if (limpo[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      dentroDeAspas = true;
    } else if (c === sep) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n') {
      linha.push(campo);
      campo = '';
      linhas.push(linha);
      linha = [];
    } else if (c !== '\r') {
      campo += c;
    }
  }

  // A última linha costuma vir sem quebra no fim.
  if (campo.length > 0 || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }

  return linhas.filter((l) => l.some((celula) => celula.trim() !== ''));
}

/**
 * Nomes de coluna aceitos para cada campo.
 *
 * Em português e em inglês porque o arquivo tanto pode ser digitado à mão quanto
 * exportado de uma ferramenta gringa — e obrigar o vendedor a renomear colunas
 * antes de importar é o tipo de exigência que faz o recurso não ser usado.
 */
const COLUNAS: Record<string, string[]> = {
  name: ['nome', 'produto', 'name', 'product', 'title', 'titulo', 'descricao'],
  priceBrl: ['preco', 'preço', 'valor', 'price', 'preco_brl', 'preçobrl'],
  variants: ['variacoes', 'variações', 'variants', 'tamanhos', 'cores', 'opcoes', 'opções'],
  shippingInfo: ['frete', 'entrega', 'shipping', 'envio'],
  promo: ['promocao', 'promoção', 'promo', 'oferta', 'desconto'],
  aliases: ['apelidos', 'aliases', 'sinonimos', 'sinônimos', 'como_chamam'],
};

/** Tira acento, espaço e pontuação para comparar nome de coluna. */
function chaveDeColuna(bruto: string): string {
  return bruto
    .normalize('NFD')
    // Os acentos viram marcas combinantes depois do NFD; sem tirá-las, "preço"
    // e "preco" seriam colunas diferentes.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Mapeia cada índice de coluna do arquivo para o campo do produto. */
export function mapearCabecalho(cabecalho: string[]): Record<number, string> {
  const mapa: Record<number, string> = {};
  cabecalho.forEach((bruto, indice) => {
    const chave = chaveDeColuna(bruto);
    for (const [campo, nomes] of Object.entries(COLUNAS)) {
      if (nomes.some((n) => chaveDeColuna(n) === chave)) {
        // Primeira coluna vence: se o arquivo tem "preço" e "preço promocional",
        // o que vale é o primeiro — e o segundo não sobrescreve por acidente.
        if (!Object.values(mapa).includes(campo)) mapa[indice] = campo;
        return;
      }
    }
  });
  return mapa;
}

/**
 * Lê um preço escrito por gente.
 *
 * Os dois mundos convivem no mesmo arquivo: "1.299,90" (Excel pt-BR) e "1299.90"
 * (exportação de sistema). Distinguir não é opcional — ler "1.299,90" como
 * 1.299 põe um produto de mil e trezentos reais na base valendo um e vinte e
 * nove, e o copiloto anuncia isso ao vivo.
 *
 * A regra: o ÚLTIMO separador presente é o decimal. É o que resolve os dois
 * casos sem precisar saber a origem do arquivo.
 */
export function lerPreco(bruto: string): number | null {
  const texto = (bruto ?? '').trim();
  if (!texto) return null;

  // Fora dígitos e separadores: some com "R$", espaço fino, "reais".
  const limpo = texto.replace(/[^\d.,-]/g, '');
  if (!limpo || !/\d/.test(limpo)) return null;

  const ultimaVirgula = limpo.lastIndexOf(',');
  const ultimoPonto = limpo.lastIndexOf('.');

  let normalizado: string;
  if (ultimaVirgula === -1 && ultimoPonto === -1) {
    normalizado = limpo;
  } else if (ultimaVirgula > ultimoPonto) {
    // Vírgula é o decimal: pontos são milhar e saem.
    normalizado = limpo.replace(/\./g, '').replace(',', '.');
  } else {
    /*
     * Ponto é o decimal — MAS só se houver uma casa decimal plausível. "1.299"
     * de um arquivo pt-BR é mil duzentos e noventa e nove, não um vírgula três:
     * exatamente três dígitos depois do último ponto e nenhuma vírgula no
     * número é a assinatura do separador de milhar.
     */
    const depois = limpo.length - ultimoPonto - 1;
    normalizado =
      depois === 3 && ultimaVirgula === -1
        ? limpo.replace(/\./g, '')
        : limpo.replace(/,/g, '');
  }

  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return Math.round(valor * 100) / 100;
}

/** Quebra uma célula de lista ("P|M|G", "P, M, G") nos itens. */
export function lerLista(bruto: string, maximo: number): string[] {
  return (bruto ?? '')
    .split(/[|;,/]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, maximo);
}

export interface ProdutoImportado {
  name: string;
  priceBrl: number | null;
  variants: string[];
  shippingInfo: string | null;
  promo: string | null;
  aliases: string[];
}

export interface ResultadoDaLeitura {
  produtos: ProdutoImportado[];
  /** Linhas recusadas, com o número da linha DO ARQUIVO e o motivo. */
  ignoradas: Array<{ linha: number; motivo: string }>;
}

/**
 * Transforma o CSV em produtos prontos para gravar.
 *
 * Nunca lança por causa de uma linha ruim: um catálogo de 300 itens com três
 * linhas quebradas tem de importar 297 e CONTAR as três. Abortar o arquivo
 * inteiro por causa de uma célula obriga o vendedor a caçar o erro sem nenhuma
 * pista — e ele desiste antes de achar.
 */
export function lerCatalogo(
  texto: string,
  limite: number,
): ResultadoDaLeitura {
  const linhas = lerCsv(texto);
  if (!linhas.length) {
    return { produtos: [], ignoradas: [] };
  }

  const mapa = mapearCabecalho(linhas[0]);
  const produtos: ProdutoImportado[] = [];
  const ignoradas: Array<{ linha: number; motivo: string }> = [];

  /*
   * Sem coluna de nome reconhecida, assume-se que a primeira coluna é o nome e
   * que o arquivo não tem cabeçalho. É o formato que sai de uma lista digitada
   * no bloco de notas, e recusar isso seria recusar o caso mais simples de
   * todos por falta de cerimônia.
   */
  const temCabecalho = Object.values(mapa).includes('name');
  const mapaEfetivo = temCabecalho ? mapa : { 0: 'name', 1: 'priceBrl' };
  const primeiraLinhaDeDados = temCabecalho ? 1 : 0;

  for (let i = primeiraLinhaDeDados; i < linhas.length; i++) {
    if (produtos.length >= limite) {
      ignoradas.push({
        linha: i + 1,
        motivo: `Limite de ${limite} produtos por importação atingido.`,
      });
      break;
    }

    const linha = linhas[i];
    const valores: Record<string, string> = {};
    for (const [indice, campo] of Object.entries(mapaEfetivo)) {
      valores[campo] = (linha[Number(indice)] ?? '').trim();
    }

    const nome = (valores.name ?? '').trim().slice(0, 200);
    if (!nome) {
      ignoradas.push({ linha: i + 1, motivo: 'Sem nome de produto.' });
      continue;
    }

    produtos.push({
      name: nome,
      priceBrl: lerPreco(valores.priceBrl ?? ''),
      variants: lerLista(valores.variants ?? '', 50).map((v) => v.slice(0, 120)),
      shippingInfo: (valores.shippingInfo ?? '').slice(0, 500) || null,
      promo: (valores.promo ?? '').slice(0, 500) || null,
      aliases: lerLista(valores.aliases ?? '', 30).map((a) => a.slice(0, 120)),
    });
  }

  return { produtos, ignoradas };
}
