/** Lê os campos de janela no arquivo bruto. SÓ LÊ. Descartável. */
import 'dotenv/config';
import AppDataSource from '../database/data-source';

async function main(): Promise<void> {
  const ds = await AppDataSource.initialize();
  for (const endpoint of ['/echotik/product/detail', '/echotik/product/list']) {
    const [linha] = await ds.query(
      `SELECT payload->'data'->0 AS item FROM api_raw_responses
        WHERE endpoint = $1 AND code = 0 AND "itemCount" > 0
        ORDER BY "createdAt" DESC LIMIT 1`,
      [endpoint],
    );
    if (!linha?.item) {
      console.log(`${endpoint}: nada arquivado`);
      continue;
    }
    const chaves = Object.keys(linha.item).filter((k) =>
      /total_sale.*(1d|7d|15d|30d|60d|90d)|total_sale_cnt|total_sale_gmv_amt/.test(k),
    );
    console.log(`\n${endpoint} — campos de venda por janela (${chaves.length}):`);
    for (const k of chaves.sort()) console.log(`  ${k} = ${JSON.stringify(linha.item[k])}`);
  }
  await ds.destroy();
}

void main();
