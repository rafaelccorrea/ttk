import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Creator } from '../../modules/creators/entities/creator.entity';
import { ProductMetricDaily } from '../../modules/products/entities/product-metric-daily.entity';
import { Product } from '../../modules/products/entities/product.entity';
import { Trend } from '../../modules/trends/entities/trend.entity';
import { Video } from '../../modules/videos/entities/video.entity';

/**
 * Remove TUDO que veio do scraper, preservando o conteúdo de seed.
 * Identificação pelos prefixos de externalId gravados na ingestão:
 *   topads-*  produtos vindos do Top Ads (fonte descartada)
 *   cc-prod-* produtos da tentativa anterior de ranking de produtos
 *   cc-top-*  vídeos de criadores em alta
 * Criadores raspados não têm prefixo, então são identificados por não
 * existirem no seed (gmvPeriod veio da nossa estimativa por views).
 *
 * Uso: npm run purge:scraped
 */
const PRODUCT_PREFIXES = ['topads-', 'cc-prod-'];
const VIDEO_PREFIXES = ['cc-top-'];

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
    entities: [Product, ProductMetricDaily, Video, Creator, Trend],
    synchronize: false,
  } as never);
  await dataSource.initialize();

  const products = dataSource.getRepository(Product);
  const metrics = dataSource.getRepository(ProductMetricDaily);
  const videos = dataSource.getRepository(Video);
  const creators = dataSource.getRepository(Creator);

  // 1) Produtos raspados (métricas caem em cascata pelo onDelete).
  let removedProducts = 0;
  for (const prefix of PRODUCT_PREFIXES) {
    const found = await products
      .createQueryBuilder('p')
      .where('p.externalId LIKE :prefix', { prefix: `${prefix}%` })
      .getMany();
    for (const product of found) {
      await metrics.delete({ productId: product.id });
    }
    const result = await products
      .createQueryBuilder()
      .delete()
      .where('externalId LIKE :prefix', { prefix: `${prefix}%` })
      .execute();
    removedProducts += result.affected ?? 0;
  }

  // 2) Handles dos criadores raspados — lidos ANTES de apagar os vídeos.
  const scrapedHandles = (
    await videos
      .createQueryBuilder('v')
      .select('LOWER(v."creatorHandle")', 'handle')
      .where('v.externalId LIKE :prefix', { prefix: 'cc-top-%' })
      .getRawMany<{ handle: string }>()
  ).map((row) => row.handle);

  // 3) Vídeos raspados.
  let removedVideos = 0;
  for (const prefix of VIDEO_PREFIXES) {
    const result = await videos
      .createQueryBuilder()
      .delete()
      .where('externalId LIKE :prefix', { prefix: `${prefix}%` })
      .execute();
    removedVideos += result.affected ?? 0;
  }

  // 4) Criadores raspados: só os que vieram junto com um vídeo cc-top-*.
  //    NUNCA usar "criador sem vídeo" como critério — os criadores do seed
  //    não têm vídeo vinculado e seriam apagados junto (já aconteceu).
  let removedCreators = 0;
  if (scrapedHandles.length > 0) {
    const result = await creators
      .createQueryBuilder()
      .delete()
      .where('LOWER(handle) IN (:...handles)', { handles: scrapedHandles })
      .execute();
    removedCreators = result.affected ?? 0;
  }

  console.log(
    `Limpeza concluída: ${removedProducts} produtos, ${removedVideos} vídeos e ${removedCreators} criadores removidos.`,
  );
  console.log('Dados de seed preservados.');
  await dataSource.destroy();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
