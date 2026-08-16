/**
 * Enche de vídeo os produtos da vitrine que estão sem nenhum.
 *
 * Roda SÓ essa camada, com teto explícito de requisições: dá para consertar a
 * credibilidade da vitrine hoje sem disparar a ingestão inteira e sem
 * descobrir, no fim do mês, que a cota foi embora nisso.
 *
 *   npx ts-node src/scripts/tapar-buraco-de-video.ts [--produtos=30] [--teto=80]
 *
 * Custo: ~2 requisições por produto (lista de vídeos + @handles dos autores),
 * mais 1 a cada 10 produtos para o detalhe em lote.
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
  const valor = Number(bruto);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
};

async function main(): Promise<void> {
  const maxProdutos = arg('produtos', 30);
  const teto = arg('teto', 80);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const quota = app.get(ApiQuotaService);
    const antes = await quota.situacao();
    console.log(
      `\nCota do mês ${antes.mes}: coleta ${antes.coleta.usado}/${antes.coleta.teto} · player ${antes.player.usado}/${antes.player.teto}`,
    );
    console.log(`Alvo: ${maxProdutos} produtos · teto de ${teto} requisições\n`);

    const ingestion = app.get(IngestionService);
    const r = await ingestion.taparBuracoDeVideo(maxProdutos, teto);

    await quota.descarregar();
    const depois = await quota.situacao();
    console.log(
      `\nProdutos que ganharam vídeo: ${r.produtos}\nRequisições gastas: ${r.requisicoes}`,
    );
    console.log(
      `Cota depois: coleta ${depois.coleta.usado}/${depois.coleta.teto} · player ${depois.player.usado}/${depois.player.teto}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(`Falhou: ${(erro as Error).message}`);
  process.exit(1);
});
