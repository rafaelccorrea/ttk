import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { AppUser } from '../modules/users/entities/app-user.entity';

/**
 * Remove uma foto de um produto do vendedor pela URL gravada em `images`.
 *
 *   npx ts-node src/scripts/remover-foto-produto.ts <email> <productId> <url>
 */
async function main() {
  const [email, productId, url] = process.argv.slice(2);
  if (!email || !productId || !url) {
    console.error('Uso: npx ts-node src/scripts/remover-foto-produto.ts <email> <productId> <url>');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const user = await users.findOneBy({ email: email.toLowerCase().trim() });
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);
    const produto = await app.get(CampaignsService).removerFoto(user.id, productId, url);
    console.log(`Restam ${produto.images.length} foto(s):\n  ${produto.images.join('\n  ')}`);
  } finally {
    await app.close();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
