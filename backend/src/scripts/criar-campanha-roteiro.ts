import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { AppUser } from '../modules/users/entities/app-user.entity';

/**
 * Cria uma campanha e gera o roteiro/storyboard (cobra créditos de roteiro).
 *
 *   npx ts-node src/scripts/criar-campanha-roteiro.ts <email> <userProductId> <personaId> [duracao] [estilo]
 */
async function main() {
  const [email, userProductId, personaId, duracao = '30', estilo = 'misto'] = process.argv.slice(2);
  if (!email || !userProductId || !personaId) {
    console.error('Uso: ... <email> <userProductId> <personaId> [duracao] [estilo]');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const user = await users.findOneBy({ email: email.toLowerCase().trim() });
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);
    const campanhas = app.get(CampaignsService);

    const campanha = await campanhas.criarCampanha(user.id, {
      userProductId,
      personaId,
      durationSeconds: Number(duracao),
      estilo: estilo as 'ugc' | 'sem_apresentador' | 'misto',
    });
    console.log(`Campanha: ${campanha.id} (${campanha.title}, ${campanha.durationSeconds}s, ${campanha.estilo})`);

    const resultado = await campanhas.gerarRoteiro(user.id, campanha.id);
    console.log(JSON.stringify(resultado, null, 2));
  } finally {
    await app.close();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
