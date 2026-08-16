/**
 * Ausculta a vitrine e imprime o que um cético veria.
 *
 * Não gasta cota: é tudo consulta ao nosso banco. A mesma auditoria roda
 * sozinha ao fim de cada ingestão — este script serve para conferir na hora.
 *
 *   npx ts-node src/scripts/auditar-vitrine.ts
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { VitrineAuditService } from '../modules/ingestion/vitrine-audit.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const r = await app.get(VitrineAuditService).auditar();
    console.log(`\nAuditoria dos ${r.topo} produtos do topo:\n`);
    for (const a of r.achados) {
      const marca = a.grave ? 'GRAVE' : ' ok  ';
      console.log(`[${marca}] ${a.titulo}: ${a.quantidade} (limite ${a.limite})`);
      if (a.grave) {
        console.log(`         ${a.porque}`);
        if (a.exemplos.length) console.log(`         ex.: ${a.exemplos.join(' | ')}`);
      }
    }
    console.log(`\nAchados graves: ${r.graves}`);
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(`Falhou: ${(erro as Error).message}`);
  process.exit(1);
});
