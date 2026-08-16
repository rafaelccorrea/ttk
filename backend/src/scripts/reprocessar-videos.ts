/**
 * Rebusca os vídeos dos produtos da vitrine, agora na ordem certa.
 *
 * Tudo que foi coletado antes da correção do `product_video_sort_field` veio em
 * ordem arbitrária — vídeos de 400 views e GMV zero em produtos campeões de
 * venda. Este script refaz a coleta pelos que MAIS venderam, com teto explícito.
 *
 *   npx ts-node src/scripts/reprocessar-videos.ts [--produtos=60] [--teto=150]
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../modules/ingestion/ingestion.service';
import { ApiQuotaService } from '../modules/ingestion/api-quota.service';

const arg = (nome: string, padrao: number): number => {
  const bruto = process.argv
    .find((a) => a.startsWith(`--${nome}=`))
    ?.split('=')[1];
  const v = Number(bruto);
  return Number.isFinite(v) && v > 0 ? v : padrao;
};

async function main(): Promise<void> {
  const produtos = arg('produtos', 60);
  const teto = arg('teto', 150);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const quota = app.get(ApiQuotaService);
    const antes = await quota.situacao();
    console.log(
      `Cota antes · coleta ${antes.coleta.usado}/${antes.coleta.teto} · player ${antes.player.usado}/${antes.player.teto}`,
    );
    console.log(`Alvo: ${produtos} produtos · teto ${teto} requisições\n`);

    const r = await app
      .get(IngestionService)
      .reprocessarVideosDaVitrine(produtos, teto);

    await quota.descarregar();
    const depois = await quota.situacao();
    console.log(`\nProdutos reprocessados: ${r.produtos}`);
    console.log(`Requisições gastas: ${r.requisicoes}`);
    console.log(
      `Cota depois · coleta ${depois.coleta.usado}/${depois.coleta.teto} · player ${depois.player.usado}/${depois.player.teto}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(`Falhou: ${(erro as Error).message}`);
  process.exit(1);
});
