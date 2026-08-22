import 'dotenv/config';
import { readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { AppUser } from '../modules/users/entities/app-user.entity';

/**
 * Cria um apresentador (persona) a partir de uma foto de referência, pelo
 * mesmo caminho de `POST /campaigns/personas/from-photo` — sem gerar retrato.
 *
 *   npx ts-node src/scripts/criar-apresentador-com-foto.ts <email> <foto> <label> '<attrs json>'
 */
async function main() {
  const [email, foto, label, attrs] = process.argv.slice(2);
  if (!email || !foto || !attrs) {
    console.error("Uso: ... <email> <foto> <label> '<attrs json>'");
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const user = await users.findOneBy({ email: email.toLowerCase().trim() });
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);
    const persona = await app
      .get(CampaignsService)
      .criarPersonaComFoto(user.id, { label, attrs }, readFileSync(foto));
    console.log(`Criada: ${persona.id}\n  label:  ${persona.label}\n  status: ${persona.status}\n  seed:   ${persona.seedImageUrl}`);
  } finally {
    await app.close();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
