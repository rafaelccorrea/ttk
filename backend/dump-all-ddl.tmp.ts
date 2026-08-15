import 'dotenv/config';
import { DataSource } from 'typeorm';

// Somente leitura: schema vazio => TypeORM imprime o DDL de TODAS as entidades.
async function main() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    schema: 'ddl_probe_readonly',
    entities: ['src/modules/**/entities/*.entity.ts'],
  });
  await ds.initialize();
  const sql = await ds.driver.createSchemaBuilder().log();
  for (const q of sql.upQueries) console.log(q.query + ';');
  await ds.destroy();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
