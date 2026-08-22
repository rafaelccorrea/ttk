import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from './app.module';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { VideogenService } from './modules/videogen/videogen.service';
import { AppUser } from './modules/users/entities/app-user.entity';
const ID = '9f707422-c370-4fbd-88f7-867a2eee3a84';
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const user = await app.get(getRepositoryToken(AppUser)).findOneBy({ email: 'rafaelgustavocorrea@gmail.com' });
  const svc = app.get(CampaignsService); const vg = app.get(VideogenService);
  // cena 4: já em voo — colhe o frame composto
  const m4 = await vg.refresh(user.id, '0a580797-b58f-4adf-aa0c-b92c102ced0e');
  if (m4.imageUrl) { const b = Buffer.from(await (await fetch(m4.imageUrl)).arrayBuffer()); require('fs').writeFileSync(process.argv[2] + '/frame4b.png', b); console.log('FRAME4 salvo', m4.status); }
  // cena 1: reabre e renderiza com voz-semente
  let d = await svc.detalharCampanha(user.id, ID);
  const c1 = d.cenas.find((c) => c.ordem === 1)!;
  if (c1.status === 'pronta') await svc.reabrirCena(user.id, c1.id);
  const r1 = await svc.renderizarCena(user.id, c1.id);
  console.log('DISPARO cena 1 ->', r1.status, r1.generatedMediaId);
  for (let i = 0; i < 26; i++) {
    await new Promise((x) => setTimeout(x, 12000));
    const a = await vg.refresh(user.id, '0a580797-b58f-4adf-aa0c-b92c102ced0e');
    const b = await vg.refresh(user.id, r1.generatedMediaId!);
    console.log('TICK', new Date().toISOString().slice(11, 19), `c4=${a.status}`, `c1=${b.status}/${b.phase} voz=${b.voiceRefUrl ? 'sim' : '-'}`);
    const fim = (m: any) => ['completed', 'failed', 'nsfw', 'canceled'].includes(m.status);
    if (fim(a) && fim(b)) break;
  }
  d = await svc.atualizarCampanha(user.id, ID);
  for (const o of [1, 4]) { const f = d.cenas.find((c) => c.ordem === o)!; console.log(`FINAL cena ${o}: ${f.status} ${f.error ?? ''}`); }
  await app.close();
})();
