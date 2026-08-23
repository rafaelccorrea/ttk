/**
 * Sondagem: o actor do Apify traz produtos da Shopee BR?
 *
 * NÃO toca no banco. Faz UMA execução síncrona do actor com uma palavra-chave,
 * imprime os campos que vieram e grava o JSON bruto em um arquivo local para a
 * gente decidir o mapeamento antes de escrever qualquer código de ingestão.
 *
 * Custo no tier FREE do Apify: US$0,05 (start) + US$0,02 por resultado.
 * Com 10 resultados ≈ US$0,25 dos US$5 mensais grátis.
 *
 * Uso:
 *   APIFY_TOKEN=xxx npx ts-node src/scripts/sondar-shopee.ts "cinta modeladora" 10
 */
import { writeFileSync } from 'node:fs';

const token = process.env.APIFY_TOKEN;
const actor = process.env.APIFY_SHOPEE_ACTOR ?? 'xtracto~shopee-scraper';
const keyword = process.argv[2] ?? 'cinta modeladora';
const max = Number(process.argv[3] ?? 10);

if (!token) {
  console.error('Defina APIFY_TOKEN (console.apify.com → Settings → Integrations).');
  process.exit(1);
}

async function main() {
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=300`;
  const input = { country: 'br', mode: 'keyword', keyword, sort: 'sales', maxProducts: max, delay: 1 };

  console.log(`→ ${actor} | "${keyword}" | até ${max} produtos`);
  const inicio = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const texto = await res.text();
  console.log(`← HTTP ${res.status} em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);

  let itens: unknown;
  try {
    itens = JSON.parse(texto);
  } catch {
    console.error('Resposta não é JSON:', texto.slice(0, 500));
    process.exit(1);
  }

  const arquivo = `sondagem-shopee-${Date.now()}.json`;
  writeFileSync(arquivo, JSON.stringify({ input, httpStatus: res.status, itens }, null, 2));
  console.log(`JSON bruto salvo em backend/${arquivo}`);

  if (!Array.isArray(itens)) {
    console.error('Corpo inesperado:', JSON.stringify(itens).slice(0, 800));
    process.exit(1);
  }
  console.log(`${itens.length} itens.`);
  if (itens.length) {
    console.log('Campos do primeiro item:', Object.keys(itens[0] as object).join(', '));
    console.log(JSON.stringify(itens[0], null, 2).slice(0, 2500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
