import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { Campaign } from '../modules/campaigns/entities/campaign.entity';
import { CampaignScene } from '../modules/campaigns/entities/campaign-scene.entity';
import { Persona } from '../modules/campaigns/entities/persona.entity';
import { AppUser } from '../modules/users/entities/app-user.entity';

/**
 * Clona uma campanha (mesmo produto, mesmo roteiro/cenas) com OUTRA persona,
 * sem gerar roteiro de novo (não cobra). Serve para comparar apresentadores
 * — e IAs — no mesmo roteiro.
 *
 *   npx ts-node src/scripts/clonar-campanha.ts <email> <campaignId> <personaId> [nomeAntigo=nomeNovo]
 */
async function main() {
  const [email, campaignId, personaId, troca] = process.argv.slice(2);
  if (!email || !campaignId || !personaId) {
    console.error('Uso: ... <email> <campaignId> <personaId> [NomeAntigo=NomeNovo]');
    process.exit(1);
  }
  const [de, para] = (troca ?? '').split('=');
  const renomear = (t: string | null) => (t && de && para ? t.split(de).join(para) : t);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const campanhas: Repository<Campaign> = app.get(getRepositoryToken(Campaign));
    const cenas: Repository<CampaignScene> = app.get(getRepositoryToken(CampaignScene));
    const personas: Repository<Persona> = app.get(getRepositoryToken(Persona));
    const svc = app.get(CampaignsService);
    const user = await users.findOneBy({ email: email.toLowerCase().trim() });
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);
    const origem = await campanhas.findOneBy({ id: campaignId, userId: user.id });
    if (!origem) throw new Error('Campanha de origem não encontrada.');
    const persona = await personas.findOneBy({ id: personaId, userId: user.id });
    if (!persona) throw new Error('Persona não encontrada.');

    const nova = await svc.criarCampanha(user.id, {
      userProductId: origem.userProductId,
      personaId: persona.id,
      durationSeconds: origem.durationSeconds,
      estilo: origem.estilo,
    });
    const originais = await cenas.find({ where: { campaignId: origem.id }, order: { ordem: 'ASC' } });
    await cenas.save(
      originais.map((c) =>
        cenas.create({
          campaignId: nova.id,
          ordem: c.ordem,
          tipo: c.tipo,
          modoAudio: c.modoAudio,
          baseImageUrl: c.baseImageUrl,
          fala: c.fala,
          acaoVisual: renomear(c.acaoVisual) ?? c.acaoVisual,
          seguraProduto: c.seguraProduto,
          modelo: c.modelo,
          status: 'pendente',
        }),
      ),
    );
    await campanhas.update(nova.id, {
      title: `${origem.title} — ${persona.label}`,
      script: renomear(origem.script),
      comoUsa: origem.comoUsa,
      status: 'storyboard',
    });
    console.log(`Campanha nova: ${nova.id} — "${origem.title} — ${persona.label}" (${originais.length} cenas, ${nova.durationSeconds}s, ${nova.estilo})`);
  } finally {
    await app.close();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
