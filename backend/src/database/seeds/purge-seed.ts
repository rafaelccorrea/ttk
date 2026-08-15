import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * Remove TODO o conteúdo de demonstração (seed) do banco.
 *
 * Motivo: o PikPok não deve exibir número inventado como se fosse dado de
 * mercado. Só fica no ar o que foi coletado de verdade.
 *
 * O que sai:
 *   products (externalId 'seed-%') + suas métricas diárias e favoritos
 *   videos   (externalId 'seed-%')
 *   creators (source = 'seed')
 *
 * O que FICA:
 *   trends           — coletadas do TikTok, são reais
 *   prompt_templates — conteúdo editorial do Cofre de Prompts (modelos de
 *                      prompt escritos por nós, não dado de mercado falso)
 *   app_users, créditos, roteiros e gerações dos usuários
 *
 * Reversível: `npm run seed`, `seed:videos` e `seed:creators` repopulam.
 *
 * Uso: npm run purge:seed
 */
async function run() {
  const url = process.env.DATABASE_URL;
  const dataSource = new DataSource({
    type: 'postgres',
    ...(url
      ? { url, ssl: { rejectUnauthorized: false } }
      : {
          host: process.env.DB_HOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? 5432),
          username: process.env.DB_USERNAME ?? 'postgres',
          password: process.env.DB_PASSWORD ?? 'postgres',
          database: process.env.DB_DATABASE ?? 'pikpok',
        }),
    entities: [],
    synchronize: false,
  } as never);
  await dataSource.initialize();

  const before = await dataSource.query(
    `SELECT (SELECT COUNT(*) FROM products) produtos,
            (SELECT COUNT(*) FROM videos) videos,
            (SELECT COUNT(*) FROM creators) criadores,
            (SELECT COUNT(*) FROM product_metrics_daily) metricas,
            (SELECT COUNT(*) FROM trends) tendencias`,
  );
  console.log('Antes:', before[0]);

  // Ordem importa: métricas e favoritos referenciam produto.
  const metrics = await dataSource.query(
    `DELETE FROM product_metrics_daily
      WHERE "productId" IN (SELECT id FROM products WHERE "externalId" LIKE 'seed-%')`,
  );
  const favorites = await dataSource.query(
    `DELETE FROM product_favorites
      WHERE "productId" IN (SELECT id FROM products WHERE "externalId" LIKE 'seed-%')`,
  );
  const savedVideos = await dataSource.query(
    `DELETE FROM saved_videos
      WHERE "videoId" IN (SELECT id FROM videos WHERE "externalId" LIKE 'seed-%')`,
  );
  const videos = await dataSource.query(
    `DELETE FROM videos WHERE "externalId" LIKE 'seed-%'`,
  );
  const products = await dataSource.query(
    `DELETE FROM products WHERE "externalId" LIKE 'seed-%'`,
  );
  const creators = await dataSource.query(
    `DELETE FROM creators WHERE source = 'seed'`,
  );

  const after = await dataSource.query(
    `SELECT (SELECT COUNT(*) FROM products) produtos,
            (SELECT COUNT(*) FROM videos) videos,
            (SELECT COUNT(*) FROM creators) criadores,
            (SELECT COUNT(*) FROM product_metrics_daily) metricas,
            (SELECT COUNT(*) FROM trends) tendencias`,
  );
  console.log('Depois:', after[0]);
  console.log(
    `Removidos — produtos: ${products[1] ?? 0}, métricas: ${metrics[1] ?? 0}, ` +
      `vídeos: ${videos[1] ?? 0}, criadores: ${creators[1] ?? 0}, ` +
      `favoritos: ${favorites[1] ?? 0}, salvos: ${savedVideos[1] ?? 0}`,
  );
  console.log('Tendências reais preservadas.');
  await dataSource.destroy();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
