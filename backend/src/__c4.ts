import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from './app.module';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { VideogenService } from './modules/videogen/videogen.service';
import { AppUser } from './modules/users/entities/app-user.entity';
const ID = '9f707422-c370-4fbd-88f7-867a2eee3a84';
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const user = await app.get(getRepositoryToken(AppUser)).findOneBy({ email: 'rafaelgustavocorrea@gmail.com' });
  const svc = app.get(CampaignsService); const vg = app.get(VideogenService);
  let d = await svc.detalharCampanha(user.id, ID);
  const c4 = d.cenas.find((c) => c.ordem === 4)!;
  if (c4.status === 'pronta') await svc.reabrirCena(user.id, c4.id);
  const r = await svc.renderizarCena(user.id, c4.id);
  let frame = '';
  for (let i = 0; i < 22; i++) {
    await new Promise((x) => setTimeout(x, 12000));
    const m = await vg.refresh(user.id, r.generatedMediaId!);
    if (!frame && m.imageUrl) { frame = m.imageUrl; const b = Buffer.from(await (await fetch(frame)).arrayBuffer()); require('fs').writeFileSync(process.argv[2] + '/frame4b.png', b); console.log('FRAME salvo'); }
    if (['completed','failed','nsfw','canceled'].includes(m.status)) { console.log('MEDIA', m.status, m.error ?? ''); break; }
  }
  d = await svc.atualizarCampanha(user.id, ID);
  const f = d.cenas.find((c) => c.ordem === 4)!;
  console.log('FINAL cena 4:', f.status, f.error ?? '');
  await app.close();
})();
