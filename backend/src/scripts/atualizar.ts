import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { Creator } from '../modules/creators/entities/creator.entity';
import { IngestionService } from '../modules/ingestion/ingestion.service';
import { TikTokOembedSource } from '../modules/ingestion/tiktok-oembed.source';
import { dedupKey, escolherDuplicados } from '../modules/ingestion/product-dedup';
import { MediaMirrorService } from '../modules/media/media-mirror.service';
import { Product } from '../modules/products/entities/product.entity';
import { Video } from '../modules/videos/entities/video.entity';

/**
 * Atualização completa do catálogo — `npm run atualiza`.
 *
 * Existe porque o processo tem partes que dependem de cota da API e partes que
 * não dependem, e rodá-las separadamente sempre deixava alguma pendente: ora
 * o vídeo ficava sem @handle, ora a imagem expirava antes de ir para o S3, ora
 * o duplicado voltava para a vitrine.
 *
 * A ordem importa e é esta:
 *
 *   1. INGESTÃO (usa cota)   — produtos, vídeos e criadores novos.
 *   2. TOP DE VENDAS (cota)  — o topo global por GMV de 30 dias, ~10 requests.
 *   3. OEMBED (grátis)       — completa @handle e capa que a cota não alcançou.
 *   4. LIMPEZA (grátis)      — remove mídia quebrada para o fallback funcionar.
 *   5. ESPELHAMENTO (grátis) — leva tudo para o S3 antes das URLs expirarem.
 *   6. DEDUPLICAÇÃO (grátis) — esconde o mesmo produto repetido.
 *
 * As etapas 3 a 6 rodam SEMPRE, mesmo sem cota — é o que garante que a tela
 * fique consistente mesmo quando a API do fornecedor está esgotada.
 *
 * ANTES DE RODAR: leia docs/COMANDOS.md. Este script escreve no banco e as
 * etapas 1 e 2 gastam cota paga (e a 1 ainda transcreve áudio com Whisper).
 */

const log = new Logger('Atualizar');

/** Só ingere (etapas 1 e 2) quando `--completo`; por padrão faz a manutenção. */
const COM_INGESTAO = process.argv.includes('--completo');

/**
 * Quantos produtos do topo global entram por execução.
 *
 * Cinquenta são 5 páginas de 10 no fornecedor (o `page_size` dele trava em 10),
 * e é fundo de lista o bastante para o ranking mudar de verdade entre um dia e
 * outro sem virar varredura. Ajustável por `--top=N`.
 */
const TOP_VENDIDOS = Number(
  process.argv.find((a) => a.startsWith('--top='))?.split('=')[1] ?? 50,
);

async function main() {
  const inicio = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const ingestion = app.get(IngestionService);
  const oembed = app.get(TikTokOembedSource);
  const mirror = app.get(MediaMirrorService);
  const produtos = app.get<Repository<Product>>(getRepositoryToken(Product));
  const videos = app.get<Repository<Video>>(getRepositoryToken(Video));
  const criadores = app.get<Repository<Creator>>(getRepositoryToken(Creator));

  // ---------------------------------------------------------------- 1) ingestão
  if (COM_INGESTAO) {
    log.log('1/6 Ingestão (consome cota da API)...');
    try {
      const run = await ingestion.run('manual');
      log.log(`     produtos ${run.productsIngested} · vídeos ${run.videosUpserted}`);
    } catch (error) {
      // Cota esgotada não pode abortar a manutenção: o resto ainda melhora a tela.
      log.warn(`     ingestão falhou (${error}) — seguindo com a manutenção`);
    }

    /*
     * O topo global, DEPOIS da ingestão e num passo próprio.
     *
     * Separado porque responde outra pergunta: as camadas da ingestão cuidam do
     * catálogo que já temos e da cobertura por nicho, e nenhuma delas traz "o
     * que mais vende no Brasil agora" — a descoberta varre categoria a
     * categoria e ainda espera a hora marcada. Este passo é o único que olha o
     * mercado inteiro, custa ~10 requests e por isso roda em toda execução
     * completa.
     *
     * Depois da ingestão, e não antes, para que a cota grande vá primeiro para
     * o refresh do catálogo: se acabar, o que se perde aqui volta na próxima.
     */
    log.log(`2/6 Top ${TOP_VENDIDOS} mais vendidos (global, por GMV de 30 dias)...`);
    try {
      const top = await ingestion.atualizarTopVendidos(TOP_VENDIDOS);
      log.log(
        `     ${top.vistos} vistos · ${top.aceitos} aceitos · ${top.requisicoes} requests`,
      );
    } catch (error) {
      log.warn(`     top de vendas falhou (${error}) — seguindo com a manutenção`);
    }
  } else {
    log.log('1/6 Ingestão pulada (use --completo para incluir)');
    log.log('2/6 Top de vendas pulado (use --completo para incluir)');
  }

  // ------------------------------------------------------------------ 3) oEmbed
  // O fornecedor devolve só o `user_id` do autor; sem o @handle o card fica sem
  // link e, às vezes, sem capa. O oEmbed do TikTok completa de graça.
  log.log('3/6 Completando @handle e capa pelo oEmbed...');
  const semHandle = await videos
    .createQueryBuilder('v')
    .where(`v."creatorHandle" ~ '^[0-9]+$' OR v."videoUrl" IS NULL`)
    .orderBy('v.views', 'DESC')
    .getMany();

  let completados = 0;
  for (const video of semHandle) {
    const tiktokId = video.externalId?.replace(/^echotik-v-/, '') ?? '';
    const dados = await oembed.fetchVideo(tiktokId);
    if (!dados) continue;
    video.creatorHandle = dados.handle;
    video.videoUrl = dados.videoUrl;
    video.thumbnailUrl = dados.thumbnailUrl ?? video.thumbnailUrl;
    await videos.save(video);
    completados += 1;
  }
  log.log(`     ${completados} de ${semHandle.length} completados`);

  // ----------------------------------------------------------------- 4) limpeza
  // URL que responde 403 (assinatura vencida) ou que aponta para um objeto que
  // não é imagem é PIOR que nula: impede o card de cair na foto do produto.
  log.log('4/6 Removendo mídia quebrada...');
  const limpos = await limparMidiaQuebrada(videos, criadores);
  log.log(`     ${limpos.videos} thumbnails e ${limpos.avatares} avatares anulados`);

  // ------------------------------------------------------------ 5) espelhamento
  // As URLs do fornecedor expiram (~72h) e renová-las custa cota. No S3 a URL
  // é nossa e não expira. As imagens ainda são padronizadas em 9:16 WebP.
  log.log('5/6 Espelhando mídia no S3...');
  if (!mirror.enabled) {
    log.warn('     S3 não configurado (AWS_S3_BUCKET) — etapa pulada');
  } else {
    const espelhados = await espelharTudo(produtos, videos, criadores, mirror);
    log.log(
      `     ${espelhados.produtos} capas · ${espelhados.videos} thumbnails · ${espelhados.avatares} avatares`,
    );
  }

  // ------------------------------------------------------------ 6) deduplicação
  // O `product_id` é único por ANÚNCIO, não por produto: o mesmo item aparece
  // várias vezes por vendedor e por variação. Marcamos e escondemos — sem
  // apagar, para não perder histórico de métricas nem favoritos.
  log.log('6/6 Marcando produtos duplicados...');
  const dup = await marcarDuplicados(produtos);
  log.log(`     ${dup.marcados} ocultados · ${dup.visiveis} visíveis`);

  await relatorioFinal(produtos, videos, criadores);
  log.log(`Concluído em ${Math.round((Date.now() - inicio) / 1000)}s`);
  await app.close();
}

/** Anula URLs que não servem mais, para o fallback de imagem entrar. */
async function limparMidiaQuebrada(
  videos: Repository<Video>,
  criadores: Repository<Creator>,
): Promise<{ videos: number; avatares: number }> {
  const acessivel = async (url: string): Promise<boolean> => {
    // Mídia já no S3 é confiável: o espelhamento recusa o que não é imagem ou
    // vídeo desde que aquele bug das páginas HTML foi corrigido. Revalidar
    // baixaria o bucket inteiro a cada execução, sem ganho.
    if (url.startsWith('/api/v1/media/s3/')) return true;
    if (!url.startsWith('http')) return true;
    try {
      const res = await fetch(url, { headers: { range: 'bytes=0-60' } });
      return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
    } catch {
      return false;
    }
  };

  let quebradosVideo = 0;
  for (const video of await videos.find({ where: {} })) {
    if (!video.thumbnailUrl) continue;
    if (await acessivel(video.thumbnailUrl)) continue;
    video.thumbnailUrl = null as unknown as string;
    await videos.save(video);
    quebradosVideo += 1;
  }

  let quebradosAvatar = 0;
  for (const criador of await criadores.find({ where: {} })) {
    if (!criador.avatarUrl) continue;
    if (await acessivel(criador.avatarUrl)) continue;
    criador.avatarUrl = null as unknown as string;
    await criadores.save(criador);
    quebradosAvatar += 1;
  }

  return { videos: quebradosVideo, avatares: quebradosAvatar };
}

/** Leva capas, thumbnails e avatares para o S3 (idempotente). */
async function espelharTudo(
  produtos: Repository<Product>,
  videos: Repository<Video>,
  criadores: Repository<Creator>,
  mirror: MediaMirrorService,
): Promise<{ produtos: number; videos: number; avatares: number }> {
  let p = 0;
  for (const produto of await produtos.find({ where: {} })) {
    if (!produto.imageUrl || produto.imageUrl.startsWith('/api/v1/media/s3/')) continue;
    const nova = await mirror.mirror(
      produto.imageUrl,
      'products',
      produto.tiktokProductId ?? produto.id,
    );
    if (!nova) continue;
    produto.imageUrl = nova;
    produto.images = [nova];
    await produtos.save(produto);
    p += 1;
  }

  let v = 0;
  for (const video of await videos.find({ where: {} })) {
    if (!video.thumbnailUrl || video.thumbnailUrl.startsWith('/api/v1/media/s3/')) continue;
    const id = video.externalId?.replace(/^echotik-v-/, '') ?? video.id;
    const nova = await mirror.mirror(video.thumbnailUrl, 'video-covers', id);
    if (!nova) continue;
    video.thumbnailUrl = nova;
    await videos.save(video);
    v += 1;
  }

  let a = 0;
  for (const criador of await criadores.find({ where: {} })) {
    if (!criador.avatarUrl || criador.avatarUrl.startsWith('/api/v1/media/s3/')) continue;
    const nova = await mirror.mirror(
      criador.avatarUrl,
      'avatars',
      criador.externalId ?? criador.id,
    );
    if (!nova) continue;
    criador.avatarUrl = nova;
    await criadores.save(criador);
    a += 1;
  }

  return { produtos: p, videos: v, avatares: a };
}

/** Recalcula a assinatura e marca as cópias. O de maior receita permanece. */
async function marcarDuplicados(
  produtos: Repository<Product>,
): Promise<{ marcados: number; visiveis: number }> {
  const linhas: Array<{ id: string; title: string; revenue: number }> =
    await produtos.query(`
      SELECT p.id, p.title, COALESCE(p."revenue30d", 0)::float AS revenue
        FROM products p
    `);

  for (const linha of linhas) {
    await produtos.query(`UPDATE products SET "dedupKey" = $2 WHERE id = $1`, [
      linha.id,
      dedupKey(linha.title),
    ]);
  }

  const duplicados = escolherDuplicados(linhas);
  await produtos.query(`UPDATE products SET "isDuplicate" = false`);
  if (duplicados.length) {
    await produtos.query(
      `UPDATE products SET "isDuplicate" = true WHERE id = ANY($1)`,
      [duplicados],
    );
  }

  const [{ n }] = await produtos.query(
    `SELECT count(*)::int n FROM products WHERE NOT "isDuplicate"`,
  );
  return { marcados: duplicados.length, visiveis: Number(n) };
}

async function relatorioFinal(
  produtos: Repository<Product>,
  videos: Repository<Video>,
  criadores: Repository<Creator>,
) {
  const [p] = await produtos.query(`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE NOT "isDuplicate")::int visiveis,
           count(*) FILTER (WHERE "sales7d" > 0)::int vendendo7d,
           count(*) FILTER (WHERE "imageUrl" IS NOT NULL)::int comImagem,
           count(DISTINCT category)::int categorias
      FROM products`);
  const [v] = await videos.query(`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE "creatorHandle" !~ '^[0-9]+$')::int comHandle,
           count(*) FILTER (WHERE "thumbnailUrl" IS NOT NULL)::int comThumb
      FROM videos`);
  const [semImagem] = await videos.query(`
    SELECT count(*)::int n
      FROM videos v LEFT JOIN products p ON p.id = v."productId"
     WHERE v."thumbnailUrl" IS NULL AND (p.id IS NULL OR p."imageUrl" IS NULL)`);
  const [c] = await criadores.query(`SELECT count(*)::int total FROM creators`);

  log.log('─────────────────────────────────────────────');
  log.log(`produtos  ${p.total} (${p.visiveis} visíveis) · ${p.categorias} categorias`);
  log.log(`          ${p.vendendo7d} venderam nos últimos 7 dias · ${p.comimagem} com imagem`);
  log.log(`vídeos    ${v.total} · ${v.comhandle} com @handle · ${v.comthumb} com thumb`);
  log.log(`          ${semImagem.n} sem imagem alguma`);
  log.log(`criadores ${c.total}`);
  log.log('─────────────────────────────────────────────');
}

main().catch((error) => {
  log.error(error);
  process.exit(1);
});
