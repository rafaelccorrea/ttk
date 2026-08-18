import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { ExternalDataProvider } from '../modules/ingestion/external-data.provider';
import { backfillPeriodos } from '../modules/ingestion/periodo-backfill';
import { Product } from '../modules/products/entities/product.entity';

/**
 * Preenche as janelas de venda dos produtos zerados — `npm run backfill:periodos`.
 *
 * O `atualiza:completo` já faz isso na etapa 3, todo dia, e é lá que o passivo
 * deixa de se formar. Este comando existe para o passivo ANTIGO: os produtos
 * que entraram no catálogo enquanto ninguém escrevia essas colunas (eram 131 de
 * 777 quando foi escrito) e que uma execução comum, limitada pelo rateio de
 * cota, levaria semanas para alcançar.
 *
 * O buraco que ele tapa: a vitrine ordena por `products.sales30d`, coluna criada
 * em 15/08 junto com a migration e que nenhum código escrevia. Produto ingerido
 * depois disso nascia com zero e ficava invisível por construção, por mais que
 * vendesse.
 *
 * CUSTO: uma requisição a cada dez produtos, via `product/detail` — o endpoint
 * mais barato por item da API. 131 produtos custam 14 requisições. Se o
 * fornecedor recusar, para e informa quantos faltaram, para ser rodado de novo
 * quando o mês virar.
 *
 *   npm run backfill:periodos              # todos os zerados
 *   npm run backfill:periodos -- --teto=20 # no máximo 20 requisições
 */

const log = new Logger('BackfillPeriodos');

const TETO = Number(
  process.argv.find((a) => a.startsWith('--teto='))?.split('=')[1] ?? 0,
);

async function main(): Promise<void> {
  const inicio = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const provider = app.get(ExternalDataProvider);
  const produtos = app.get<Repository<Product>>(getRepositoryToken(Product));

  /*
   * A janela de cota é aberta AQUI porque quem chama é quem manda: o
   * `backfillPeriodos` só gasta o que já foi autorizado. Sem teto explícito, o
   * limite é o número de lotes que os alvos exigem — o `--teto` existe para
   * quando se quer provar o caminho gastando pouco.
   */
  provider.beginRun(TETO > 0 ? TETO : Number.MAX_SAFE_INTEGER);

  const r = await backfillPeriodos({
    provider,
    produtos,
    aoProgredir: (m) => log.log(m),
  });

  log.log('─────────────────────────────────────────────');
  log.log(`alvos                ${r.alvos}`);
  log.log(`preenchidos          ${r.preenchidos}`);
  log.log(`sem dado no fornecedor ${r.semDado}`);
  log.log(`ainda zerados        ${r.restantes}`);
  log.log(`requisições gastas   ${r.requisicoes}`);
  if (r.restantes > 0) {
    log.warn(
      `${r.restantes} produtos continuam fora do ranking. Se a cota do mês ` +
        `acabou, rode de novo depois da virada.`,
    );
  }
  log.log(`Concluído em ${Math.round((Date.now() - inicio) / 1000)}s`);

  await app.close();
}

main().catch((erro) => {
  log.error(`Falhou: ${(erro as Error).message}`);
  process.exit(1);
});
