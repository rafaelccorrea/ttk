import 'dotenv/config';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { AppUser } from '../modules/users/entities/app-user.entity';

/**
 * Anexa fotos locais a um produto do vendedor (user_products), pelo mesmo
 * caminho do upload do app (espelha no S3 em `contain`).
 *
 *   npx ts-node src/scripts/anexar-foto-produto.ts <email> <productId> <arquivo...>
 */
async function main() {
  const [email, productId, ...arquivos] = process.argv.slice(2);
  if (!email || !productId || !arquivos.length) {
    console.error('Uso: npx ts-node src/scripts/anexar-foto-produto.ts <email> <productId> <arquivo...>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const campanhas = app.get(CampaignsService);
    const user = await users.findOneBy({ email: email.toLowerCase().trim() });
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);

    for (const arquivo of arquivos) {
      try {
        const produto = await campanhas.adicionarFoto(user.id, productId, readFileSync(arquivo));
        console.log(`OK    ${basename(arquivo)} -> ${produto.images[produto.images.length - 1]}`);
      } catch (err) {
        console.log(`FALHA ${basename(arquivo)} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
