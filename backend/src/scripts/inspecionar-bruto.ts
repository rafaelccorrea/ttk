/**
 * Chama o fornecedor sobre UM produto e mostra o que ele respondeu, cru.
 *
 * Serve para responder "o número zerado é culpa do parse ou já veio zerado da
 * origem?" — pergunta que, sem o arquivo de respostas, só se respondia pagando
 * a requisição de novo e olhando no olho.
 *
 *   npx ts-node src/scripts/inspecionar-bruto.ts <tiktokProductId> [--campos=gmv]
 *
 * Custa 2 requisições (detalhe do produto + lista de vídeos) e deixa as duas
 * guardadas em `api_raw_responses`.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ExternalDataProvider } from '../modules/ingestion/external-data.provider';
import { ApiArchiveService } from '../modules/ingestion/api-archive.service';

async function main(): Promise<void> {
  const produtoId = process.argv[2];
  if (!produtoId) throw new Error('Informe o tiktokProductId.');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const provider = app.get(ExternalDataProvider);
    const archive = app.get(ApiArchiveService);

    await provider.fetchProductDetails([produtoId]);
    await provider.fetchProductVideos(produtoId, 10);

    // Dá tempo da gravação assíncrona alcançar.
    await new Promise((r) => setTimeout(r, 1500));

    const registros = await archive.buscarPorAssunto(produtoId, 5);
    for (const reg of registros) {
      console.log(`\n=== ${reg.endpoint} · code=${reg.code} · itens=${reg.itemCount}`);
      const dados = (reg.payload as { data?: unknown })?.data;
      const linhas = Array.isArray(dados) ? dados : dados ? [dados] : [];
      const primeira = linhas[0] as Record<string, unknown> | undefined;
      if (!primeira) {
        console.log('  (sem itens)');
        continue;
      }
      // Só os campos de dinheiro e venda — o resto polui.
      const interesse = Object.entries(primeira).filter(([k]) =>
        /gmv|sale|price|revenue|views|video_cnt/i.test(k),
      );
      for (const [k, v] of interesse) {
        console.log(`  ${k} = ${JSON.stringify(v)?.slice(0, 120)}`);
      }
      if (linhas.length > 1) {
        const somaGmv = linhas.reduce(
          (acc: number, l) =>
            acc + Number((l as Record<string, unknown>).total_video_sale_gmv_amt ?? 0),
          0,
        );
        console.log(`  → soma de total_video_sale_gmv_amt nas ${linhas.length} linhas: ${somaGmv}`);
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(`Falhou: ${(erro as Error).message}`);
  process.exit(1);
});
