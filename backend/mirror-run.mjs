// Espelha no S3 TODA a mídia já gravada no banco e reescreve as URLs.
// Zero chamadas ao EchoTik — usa as assinaturas que ainda estão válidas.
// Rode assim que o bucket existir: é o que salva as imagens antes de expirarem.
import pg from 'pg';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.AWS_S3_BUCKET;
// Bucket PRIVADO: guardamos a rota da nossa API, que lê do S3 com credencial.
// Nada fica exposto publicamente e a URL nunca expira.
const PUBLIC_BASE = process.env.AWS_S3_PUBLIC_BASE ?? '/api/v1/media/s3';

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const MIME = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', mp4:'video/mp4' };
const extOf = u => (/\.([a-z0-9]+)$/i.exec(u.split('?')[0])?.[1] ?? '').toLowerCase();

let ok = 0, pulados = 0, falhas = 0;

async function mirror(url, prefix, id) {
  if (!url) return null;
  // Já é nosso: não reprocessa.
  if (url.startsWith(PUBLIC_BASE)) { pulados++; return url; }

  const clean = url.split('?')[0];
  const e = extOf(clean);
  const key = `${prefix}/${id}-${createHash('sha1').update(clean).digest('hex').slice(0,16)}${e ? '.' + e : ''}`;

  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); ok++; return `${PUBLIC_BASE}/${key}`; }
  catch { /* ainda não existe */ }

  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow' });
    if (!r.ok) { falhas++; return null; }
    const body = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type');
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: body,
      ContentType: /^(image|video)\//.test(type ?? '') ? type : (MIME[e] ?? 'application/octet-stream'),
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    ok++;
    return `${PUBLIC_BASE}/${key}`;
  } catch (err) { falhas++; console.log('  falhou', key, String(err).slice(0, 60)); return null; }
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// --- produtos: capa + galeria ------------------------------------------------
const { rows: prods } = await c.query(
  `SELECT id, "tiktokProductId" pid, "imageUrl", images FROM products WHERE "imageUrl" IS NOT NULL`);
console.log(`produtos: ${prods.length}`);
for (const p of prods) {
  const id = p.pid ?? p.id;
  const cover = await mirror(p.imageUrl, 'products', id);
  const gal = [];
  for (const g of (Array.isArray(p.images) ? p.images : [])) {
    const m = await mirror(g, 'products', id);
    if (m) gal.push(m);
  }
  if (cover || gal.length) {
    await c.query(`UPDATE products SET "imageUrl"=COALESCE($2,"imageUrl"), images=$3 WHERE id=$1`,
      [p.id, cover, JSON.stringify(gal.length ? gal : (cover ? [cover] : []))]);
  }
}

// --- vídeos: thumbnail (e MP4, se já resolvido) -------------------------------
const { rows: vids } = await c.query(
  `SELECT id, "externalId", "thumbnailUrl", "playbackUrl" FROM videos
    WHERE "thumbnailUrl" IS NOT NULL OR "playbackUrl" IS NOT NULL`);
console.log(`vídeos: ${vids.length}`);
for (const v of vids) {
  const vid = String(v.externalId ?? v.id).replace(/^echotik-v-/, '');
  const thumb = await mirror(v.thumbnailUrl, 'video-covers', vid);
  // O MP4 expira em horas; só espelha se ainda estiver válido.
  const play = await mirror(v.playbackUrl, 'videos', vid);
  await c.query(
    `UPDATE videos SET "thumbnailUrl"=COALESCE($2,"thumbnailUrl"),
       "playbackUrl"=COALESCE($3,"playbackUrl"),
       "playbackExpiresAt"=CASE WHEN $3 IS NOT NULL THEN NULL ELSE "playbackExpiresAt" END
     WHERE id=$1`, [v.id, thumb, play]);
}

// --- criadores: avatar --------------------------------------------------------
const { rows: cres } = await c.query(
  `SELECT id, "externalId", "avatarUrl" FROM creators WHERE "avatarUrl" IS NOT NULL`);
console.log(`criadores: ${cres.length}`);
for (const cr of cres) {
  const a = await mirror(cr.avatarUrl, 'avatars', cr.externalId ?? cr.id);
  if (a) await c.query(`UPDATE creators SET "avatarUrl"=$2 WHERE id=$1`, [cr.id, a]);
}

console.log(`\nespelhados ${ok} · já eram nossos ${pulados} · falharam ${falhas}`);
const { rows:[s] } = await c.query(`
  SELECT (SELECT count(*) FROM products WHERE "imageUrl" LIKE $1)::int p,
         (SELECT count(*) FROM videos   WHERE "thumbnailUrl" LIKE $1)::int v,
         (SELECT count(*) FROM creators WHERE "avatarUrl" LIKE $1)::int c`,
  [PUBLIC_BASE + '%']);
console.log(`agora no S3: ${s.p} capas · ${s.v} thumbnails · ${s.c} avatares`);
await c.end();
