import { Repository } from 'typeorm';
import { ExternalDataProvider } from './external-data.provider';
import { aplicarPeriodo, periodoDe } from './ingestion.service';
import { Product } from '../products/entities/product.entity';

/** O `product/detail` aceita dez ids por chamada — é o item mais barato da API. */
const LOTE = 10;

export interface ResultadoBackfill {
  alvos: number;
  preenchidos: number;
  semDado: number;
  restantes: number;
  requisicoes: number;
}

/**
 * Preenche as janelas de venda dos produtos que estão zerados.
 *
 * Mora aqui, e não dentro do script, porque tem DOIS donos: o comando avulso
 * (`npm run backfill:periodos`, para tratar um passivo grande de uma vez) e a
 * execução completa do `atualizar.ts`, que precisa impedir que o passivo volte
 * a se formar. Produto que entra no catálogo hoje e não recebe janela nasce
 * invisível — ordenar por `sales30d` o deixa no fim da fila para sempre.
 *
 * Quem administra a janela de cota é o CHAMADOR: aqui só se gasta o que já foi
 * autorizado. Isso evita a dupla contagem de orçamento que aconteceu quando o
 * passo do top abriu uma segunda janela dentro da mesma execução.
 */
export async function backfillPeriodos(opts: {
  provider: ExternalDataProvider;
  produtos: Repository<Product>;
  /** Teto de produtos a tratar nesta passada. */
  limite?: number;
  aoProgredir?: (mensagem: string) => void;
}): Promise<ResultadoBackfill> {
  const { provider, produtos, limite, aoProgredir } = opts;
  const requisicoesAntes = provider.requestsUsed;

  /*
   * O alvo é quem tem id da TikTok Shop e nenhuma janela preenchida. Produto
   * sem `tiktokProductId` — os extraídos de anúncio, por exemplo — não tem como
   * ser consultado, então fica de fora em vez de gastar requisição à toa.
   *
   * A ordem é do mais novo para o mais velho: o recém-descoberto é justamente o
   * que acabou de custar cota e ainda não aparece em lugar nenhum da vitrine.
   */
  const consulta = produtos
    .createQueryBuilder('p')
    .where('p."tiktokProductId" IS NOT NULL')
    .andWhere('p."sales30d" = 0')
    .andWhere('p."sales90d" = 0')
    .orderBy('p."createdAt"', 'DESC');
  if (limite && limite > 0) consulta.take(limite);
  const alvos = await consulta.getMany();

  let preenchidos = 0;
  let semDado = 0;

  for (let i = 0; i < alvos.length; i += LOTE) {
    if (provider.budgetExhausted) break;

    const chunk = alvos.slice(i, i + LOTE);
    const detalhes = await provider.fetchProductDetails(
      chunk.map((p) => p.tiktokProductId!).filter(Boolean),
    );
    // Nada de volta significa cota esgotada, disjuntor armado ou ids que
    // sumiram do catálogo do fornecedor. Em todos os casos, insistir não ajuda.
    if (detalhes.size === 0) break;

    for (const produto of chunk) {
      const ext = detalhes.get(produto.tiktokProductId!);
      if (!ext) {
        semDado += 1;
        continue;
      }
      const antes = produto.sales30d;
      aplicarPeriodo(produto, periodoDe(ext));
      if (produto.sales30d !== antes) preenchidos += 1;
      await produtos.save(produto);
    }

    aoProgredir?.(
      `${Math.min(i + LOTE, alvos.length)}/${alvos.length} conferidos · ${preenchidos} preenchidos`,
    );
  }

  const restantes = await produtos
    .createQueryBuilder('p')
    .where('p."tiktokProductId" IS NOT NULL')
    .andWhere('p."sales30d" = 0')
    .getCount();

  return {
    alvos: alvos.length,
    preenchidos,
    semDado,
    restantes,
    requisicoes: provider.requestsUsed - requisicoesAntes,
  };
}
