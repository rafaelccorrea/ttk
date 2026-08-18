import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';

/** Quantas posições o comparativo observa. É o topo que a vitrine mostra. */
export const TAMANHO_DO_TOPO = 50;

export interface LinhaDoTopo {
  id: string;
  title: string;
  sales30d: number;
}

export interface DiferencaDoTopo {
  entraram: LinhaDoTopo[];
  sairam: LinhaDoTopo[];
  /** Quem ficou, mas mudou de posição. */
  moveram: Array<{ title: string; de: number; para: number }>;
  /** Quem mudou de número de vendas, mesmo sem trocar de posição. */
  numerosMudaram: number;
  /** Nada mudou: nem entrada, nem saída, nem posição, nem número. */
  identico: boolean;
}

/**
 * Fotografa o topo da vitrine.
 *
 * A ordenação é a MESMA da tela (`sales30d` desc, `id` como desempate) de
 * propósito: um comparativo que ordene diferente do que o usuário vê responde
 * outra pergunta e dá falsa tranquilidade.
 */
export async function fotografarTopo(
  produtos: Repository<Product>,
  tamanho = TAMANHO_DO_TOPO,
): Promise<LinhaDoTopo[]> {
  return produtos
    .createQueryBuilder('p')
    .select(['p.id AS id', 'p.title AS title', 'p."sales30d" AS "sales30d"'])
    .where('p."isDuplicate" = false')
    .orderBy('p."sales30d"', 'DESC')
    .addOrderBy('p.id', 'ASC')
    .limit(tamanho)
    .getRawMany<LinhaDoTopo>();
}

/**
 * Compara duas fotos do topo.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Uma execução completa trouxe 24 produtos novos, atualizou métricas e gastou
 * cota e Whisper — e o topo da vitrine não mudou uma linha. O motivo era grave
 * (as colunas de janela que ordenam a tela não eram escritas por ninguém desde
 * que foram criadas) e passou despercebido porque NINGUÉM OLHAVA: o relatório
 * final contava produtos, vídeos e criadores, todos crescendo, enquanto a tela
 * que o cliente abre ficava congelada.
 *
 * Então o topo idêntico deixa de ser silêncio e vira aviso. Ele não prova
 * defeito — um dia sem mexer no ranking é plausível —, mas dois ou três seguidos
 * significam que a coleta parou de chegar na vitrine, e isso é o que se quer
 * descobrir na hora, não um mês depois.
 */
export function compararTopo(
  antes: LinhaDoTopo[],
  depois: LinhaDoTopo[],
): DiferencaDoTopo {
  const posicaoAntes = new Map(antes.map((l, i) => [l.id, i + 1]));
  const vendasAntes = new Map(antes.map((l) => [l.id, Number(l.sales30d)]));
  const idsDepois = new Set(depois.map((l) => l.id));

  const entraram = depois.filter((l) => !posicaoAntes.has(l.id));
  const sairam = antes.filter((l) => !idsDepois.has(l.id));

  const moveram: DiferencaDoTopo['moveram'] = [];
  let numerosMudaram = 0;
  depois.forEach((linha, i) => {
    const de = posicaoAntes.get(linha.id);
    if (de === undefined) return;
    const para = i + 1;
    if (de !== para) moveram.push({ title: linha.title, de, para });
    if (Number(linha.sales30d) !== vendasAntes.get(linha.id)) numerosMudaram += 1;
  });

  return {
    entraram,
    sairam,
    moveram,
    numerosMudaram,
    identico:
      entraram.length === 0 &&
      sairam.length === 0 &&
      moveram.length === 0 &&
      numerosMudaram === 0,
  };
}

/** O comparativo em linhas prontas para o log. */
export function relatarTopo(d: DiferencaDoTopo, tamanho = TAMANHO_DO_TOPO): string[] {
  if (d.identico) {
    return [
      `TOP ${tamanho} IDÊNTICO — nenhuma entrada, saída, troca de posição ou`,
      `mudança de número. Se repetir na próxima execução, a coleta não está`,
      `chegando na vitrine: confira se as janelas (sales30d) estão sendo`,
      `gravadas e rode "npm run backfill:periodos".`,
    ];
  }
  const linhas = [
    `top ${tamanho}: ${d.entraram.length} entraram · ${d.sairam.length} saíram · ` +
      `${d.moveram.length} mudaram de posição · ${d.numerosMudaram} tiveram número novo`,
  ];
  for (const e of d.entraram.slice(0, 5)) {
    linhas.push(`  + ${e.title.slice(0, 60)} (${e.sales30d} vendas em 30d)`);
  }
  for (const s of d.sairam.slice(0, 5)) {
    linhas.push(`  - ${s.title.slice(0, 60)}`);
  }
  return linhas;
}
