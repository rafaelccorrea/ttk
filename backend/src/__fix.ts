import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from './app.module';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { VideogenService } from './modules/videogen/videogen.service';
import { AppUser } from './modules/users/entities/app-user.entity';
const C3 = '998a4b93-89d4-4fbc-bb49-9e005747bcde', C6 = '03c5382a-ad14-4eee-a064-572432a8dea2';
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const user = await app.get(getRepositoryToken(AppUser)).findOneBy({ email: 'rafaelgustavocorrea@gmail.com' });
  const svc = app.get(CampaignsService); const vg = app.get(VideogenService);
  let d = await svc.detalharCampanha(user.id, 'a92af6d1-27b8-4b73-b096-83ca7aafd5a0');
  const c6 = d.cenas.find((c) => c.id === C6)!;
  if (c6.status === 'pronta') await svc.reabrirCena(user.id, C6);
  const e6 = await svc.editarCena(user.id, C6, { tipoCena: 'apresentador', acaoVisual: 'Plano médio na sala, Jéssica de frente, relaxada e sorridente, como quem termina uma conversa com uma amiga. Aponta uma vez para baixo com a mão, indicando o link, depois junta as mãos num gesto de é isso. Push-in curto da câmera, olhar fixo na lente até o último frame, luz quente, sem objetos novos em quadro.' });
  console.log(`cena 6: ${e6.tipo}/${e6.modoAudio} ${e6.status}`);
  const c3 = d.cenas.find((c) => c.id === C3)!;
  console.log(`cena 3 antes: ${c3.status}`);
  if (c3.status === 'pronta') await svc.reabrirCena(user.id, C3);
  const r3 = await svc.renderizarCena(user.id, C3);
  console.log(`cena 3 -> ${r3.status} media=${r3.generatedMediaId}`);
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 12000));
    const m = await vg.refresh(user.id, r3.generatedMediaId!);
    console.log(`${new Date().toISOString().slice(11,19)} ${m.status}/${m.phase} model=${m.model} err=${m.error ?? '-'}`);
    if (m.phase === 'video' || ['failed','nsfw','canceled'].includes(m.status)) break;
  }
  await app.close();
})();
