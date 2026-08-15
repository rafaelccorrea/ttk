// Aprofunda o catálogo: varre TODAS as categorias, várias páginas cada,
// gastando o que restar da cota. 1 request = 10 produtos; +1 por lote de capas.
import pg from 'pg';
import { readFileSync } from 'node:fs';

const AUTH = 'Basic ' + Buffer.from('260815567212626505:095fa63c1d97448c996dc9a2b7a615a8').toString('base64');
const B = 'https://open.echotik.live/api/v3';
const HOST = 'echosell-images.tos-ap-southeast-1.volces.com';
const BUDGET = 66;          // sobra do que já foi gasto nesta chave
const PAGINAS_POR_CATEGORIA = 4;

let paid = 0;
const api = async (p, q) => {
  if (paid >= BUDGET) return null;
  const u = new URL(B + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, String(v));
  paid++;
  const r = await fetch(u, { headers: { accept: 'application/json', Authorization: AUTH } });
  const b = await r.json();
  if (b.code !== 0) { console.log('  !', b.code, String(b.message).slice(0, 44)); return null; }
  return b.data;
};
const str = v => (v == null || String(v).trim() === '' ? null : String(v).trim());
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const covers = raw => {
  const t = str(raw); if (!t) return [];
  if (t.startsWith('http')) return [t];
  try { const a = JSON.parse(t);
    return Array.isArray(a) ? a.slice().sort((x,y)=>(x.index??0)-(y.index??0)).map(x=>x.url).filter(Boolean) : [];
  } catch { return []; }
};
const brlPrice = raw => {
  const t = str(raw); if (!t) return null;
  try { const s = JSON.parse(t);
    const p = (Array.isArray(s)?s:[]).map(x=>x.real_price).filter(x=>x?.currency_name==='BRL')
      .map(x=>Number(x.sale_price_decimal)).filter(n=>Number.isFinite(n)&&n>0);
    return p.length ? Math.min(...p) : null;
  } catch { return null; }
};

const src = readFileSync('./src/modules/ingestion/product-categories.ts', 'utf8');
const CATS = {}; for (const m of src.matchAll(/'([^']+)':\s*'([^']+)'/g)) CATS[m[1]] = m[2];
const SKIP = new Set(['0','834312','2344592','601303','951432','856720']);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(`select category, count(*)::int n from products group by 1`);
const have = new Map(rows.map(r => [r.category, r.n]));

// Menos povoadas primeiro: assim a cota melhora a cobertura antes de aprofundar.
const cats = Object.entries(CATS).filter(([id]) => !SKIP.has(id))
  .map(([id, name]) => ({ id, name, n: have.get(name) ?? 0 }))
  .sort((a, b) => a.n - b.n);

const today = new Date().toISOString().slice(0, 10);
let novos = 0, atualizados = 0;

// Rodízio: uma página por categoria a cada volta, até a cota acabar.
for (let pagina = 2; pagina <= PAGINAS_POR_CATEGORIA + 1; pagina++) {
  for (const cat of cats) {
    if (paid + 2 > BUDGET) { console.log('\n[cota no fim]'); pagina = 99; break; }

    const lista = await api('/echotik/product/list', {
      region: 'BR', category_id: cat.id, page_num: pagina, page_size: 10,
      product_sort_field: 7, sort_type: 1, min_total_sale_30d_cnt: 50,
    });
    if (!lista?.length) continue;

    const capas = lista.map(r => covers(r.cover_url)[0]).filter(u => u?.includes(HOST)).slice(0, 10);
    const signed = new Map();
    if (capas.length) {
      const res = await api('/echotik/batch/cover/download', { cover_urls: capas.join(',') });
      for (const row of res ?? []) for (const [s, d] of Object.entries(row ?? {})) if (d) signed.set(s, d);
    }

    let n = 0;
    for (const row of lista) {
      const pid = str(row.product_id), title = str(row.product_name)?.replace(/\s+/g, ' ');
      const seller = str(row.seller_id);
      if (!pid || !title || !seller || str(row.region) !== 'BR' || num(row.total_sale_cnt) < 1) continue;
      const usd = num(row.spu_avg_price), b = brlPrice(row.skus), price = b ?? usd;
      if (price <= 0) continue;
      const rate = b && usd > 0 ? b / usd : 1;
      const cover = signed.get(covers(row.cover_url)[0]) ?? null;

      const { rows: [p] } = await c.query(
        `INSERT INTO products ("externalId","tiktokProductId",title,category,price,"imageUrl",images,"tiktokUrl","lastRefreshedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT ("externalId") DO UPDATE SET
           price=EXCLUDED.price,
           "imageUrl"=COALESCE(EXCLUDED."imageUrl",products."imageUrl"),
           images=COALESCE(EXCLUDED.images,products.images),
           "tiktokProductId"=EXCLUDED."tiktokProductId","lastRefreshedAt"=now()
         RETURNING id,(xmax=0) AS inserted`,
        [`echotik-${pid}`, pid, title.slice(0,255), CATS[cat.id] ?? 'Outros', price.toFixed(2),
         cover, JSON.stringify(cover ? [cover] : []), `https://shop.tiktok.com/view/product/${pid}`]);
      p.inserted ? novos++ : atualizados++;
      n++;

      await c.query(
        `INSERT INTO product_metrics_daily ("productId",date,sales,revenue) VALUES ($1,$2,$3,$4)
         ON CONFLICT ("productId",date) DO UPDATE SET sales=EXCLUDED.sales, revenue=EXCLUDED.revenue`,
        [p.id, today, Math.round(num(row.total_sale_1d_cnt)), (num(row.total_sale_gmv_1d_amt)*rate).toFixed(2)]);
    }
    if (n) console.log(`p${pagina} ${cat.name.padEnd(26)} +${String(n).padStart(2)}  (${paid}/${BUDGET})`);
  }
}

const { rows:[s] } = await c.query(
  `select count(*)::int p, count(distinct category)::int cats from products`);
console.log(`\nnovos ${novos} · atualizados ${atualizados}`);
console.log(`catálogo: ${s.p} produtos em ${s.cats} categorias`);
console.log(`REQUESTS: ${paid}/${BUDGET}`);
await c.end();
