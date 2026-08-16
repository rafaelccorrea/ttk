/**
 * Repara as capas de produto que não estão no nosso bucket.
 *
 * A URL assinada do fornecedor expira em ~3 dias, e o CDN dele às vezes
 * responde HTTP 200 com uma página de erro dentro — nesses casos o
 * espelhamento recusa e o card fica sem foto. Este script pede uma assinatura
 * nova (endpoint que NÃO consome cota) e tenta espelhar de novo.
 *
 *   npx ts-node src/scripts/reparar-imagens.ts [--limite=50]
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from '../app.module';
import { Product } from '../modules/products/entities/product.entity';
import { ExternalDataProvider } from '../modules/ingestion/external-data.provider';
import { MediaMirrorService } from '../modules/media/media-mirror.service';

async function main(): Promise<void> {
  const limite = Number(
    process.argv.find((a) => a.startsWith('--limite='))?.split('=')[1] ?? 50,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const products = app.get<Repository<Product>>(getRepositoryToken(Product));
    const provider = app.get(ExternalDataProvider);
    const mirror = app.get(MediaMirrorService);

    // Quem está com imagem fora do nosso bucket (ou sem imagem, mas com
    // candidatas guardadas em `images`).
    const alvos = await products
      .createQueryBuilder('p')
      .where(
        `(p."imageUrl" IS NULL OR p."imageUrl" NOT LIKE '/api/v1/media/s3/%')`,
      )
      .orderBy('p."sales30d"', 'DESC')
      .take(limite)
      .getMany();

    console.log(`Produtos a reparar: ${alvos.length}\n`);
    let ok = 0;

    for (const p of alvos) {
      // Todas as candidatas: a capa atual e as demais fotos guardadas.
      const candidatas = [p.imageUrl, ...(p.images ?? [])].filter(
        (u): u is string => Boolean(u),
      );
      if (!candidatas.length) continue;

      // Assinatura nova (de graça) para as que são do host assinável.
      const assinadas = await provider.signImageUrls(candidatas);

      let novaUrl: string | null = null;
      for (const bruta of candidatas) {
        const url = assinadas.get(bruta) ?? bruta;
        novaUrl = await mirror.mirror(url, 'product-covers', p.id);
        if (novaUrl) break; // primeira que decodifica como imagem serve
      }

      if (novaUrl) {
        p.imageUrl = novaUrl;
        await products.save(p);
        ok += 1;
        console.log(`  ok   ${p.title.slice(0, 55)}`);
      } else {
        // Sem foto válida: melhor o espaço reservado do que o link quebrado.
        if (p.imageUrl && !p.imageUrl.startsWith('/api/v1/media/s3/')) {
          p.imageUrl = null;
          await products.save(p);
        }
        console.log(`  --   ${p.title.slice(0, 55)} (nenhuma capa válida)`);
      }
    }

    console.log(`\nReparados: ${ok} de ${alvos.length}`);
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(`Falhou: ${(erro as Error).message}`);
  process.exit(1);
});
