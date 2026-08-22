import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { UserProduct } from '../modules/campaigns/entities/user-product.entity';
import { AppUser } from '../modules/users/entities/app-user.entity';

/**
 * Cadastra o próprio PikPok como produto do vendedor (user_products) numa
 * conta, para gerar criativos do sistema no Estúdio.
 *
 *   npx ts-node src/scripts/criar-produto-pikpok.ts <email>
 *
 * Idempotente: se a conta já tem um produto com esse nome, não duplica.
 */
const NOME = 'PikPok Sistema';

async function main() {
  const email = (process.argv[2] ?? '').toLowerCase().trim();
  if (!email) {
    console.error('Uso: npx ts-node src/scripts/criar-produto-pikpok.ts <email>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const produtos: Repository<UserProduct> = app.get(getRepositoryToken(UserProduct));
    const campanhas = app.get(CampaignsService);

    const user = await users.findOneBy({ email });
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);

    const existente = await produtos.findOneBy({ userId: user.id, name: NOME });
    if (existente) {
      console.log(`Já existe (${existente.id}) — nada criado.`);
      return;
    }

    const appUrl = (process.env.APP_URL ?? 'https://pikpokviral.com.br').replace(/\/+$/, '');
    const produto = await campanhas.criarProduto(user.id, {
      name: NOME,
      priceBrl: 39.9,
      benefit:
        'Mostra em minutos quais produtos estão vendendo no TikTok Shop e gera os vídeos prontos para postar — roteiro, narração e variações.',
      problemSolved:
        'Perder horas garimpando produto e gravando vídeo no escuro, sem saber o que realmente converte.',
      images: [`${appUrl}/logo-full.jpg`],
    });

    console.log(`Criado: ${produto.id}`);
    console.log(`  nome:    ${produto.name}`);
    console.log(`  preço:   R$ ${produto.priceBrl}`);
    console.log(`  imagens: ${produto.images.length ? produto.images.join(', ') : '(nenhuma — espelhamento S3 indisponível)'}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
