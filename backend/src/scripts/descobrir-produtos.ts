/**
 * Varre as categorias atrás de produtos que ainda não temos.
 *
 * Já sai com os filtros novos: só produto com pelo menos um vídeo
 * (`min_total_video_cnt=1`) e que ainda está à venda (`off_mark=0`) — para
 * nenhum card novo nascer mudo na vitrine.
 *
 *   npx ts-node src/scripts/descobrir-produtos.ts [--paginas=2] [--teto=120]
 *
 * Custo: 1 requisição por página de categoria (10 produtos cada), mais 1 a
 * cada 10 capas assinadas (essa parte é de graça).
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../modules/ingestion/ingestion.service';
import { ApiQuotaService } from '../modules/ingestion/api-quota.service';
import { VitrineAuditService } from '../modules/ingestion/vitrine-audit.service';

const arg = (nome: string, padrao: number): number => {
  const bruto = process.argv
    .find((a) => a.startsWith(`--${nome}=`))
    ?.split('=')[1];
  const v = Number(bruto);
  return Number.isFinite(v) && v > 0 ? v : padrao;
};

async function main(): Promise<void> {
  const paginas = arg('paginas', 2);
  const teto = arg('teto', 120);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const quota = app.get(ApiQuotaService);
    const antes = await quota.situacao();
    console.log(
      `Cota antes · coleta ${antes.coleta.usado}/${antes.coleta.teto} · player ${antes.player.usado}/${antes.player.teto}`,
    );
    console.log(`Varrendo ${paginas} página(s) por categoria · teto ${teto} requisições\n`);

    const r = await app.get(IngestionService).descobrirNovos(paginas, teto);

    await quota.descarregar();
    const depois = await quota.situacao();
    console.log(`\nProdutos vistos: ${r.vistos}`);
    console.log(`Produtos NOVOS no catálogo: ${r.novos}`);
    console.log(`Requisições gastas: ${r.requisicoes}`);
    console.log(
      `Cota depois · coleta ${depois.coleta.usado}/${depois.coleta.teto} · player ${depois.player.usado}/${depois.player.teto}`,
    );

    // A vitrine mudou: vale conferir na hora, e não pelo print de quem usa.
    const auditoria = await app.get(VitrineAuditService).auditar();
    console.log('\n--- auditoria da vitrine ---');
    for (const a of auditoria.achados) {
      console.log(
        `[${a.grave ? 'GRAVE' : ' ok  '}] ${a.titulo}: ${a.quantidade} (limite ${a.limite})`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(`Falhou: ${(erro as Error).message}`);
  process.exit(1);
});
