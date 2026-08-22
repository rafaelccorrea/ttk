import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from './app.module';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { AppUser } from './modules/users/entities/app-user.entity';
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const user = await app.get(getRepositoryToken(AppUser)).findOneBy({ email: 'rafaelgustavocorrea@gmail.com' });
  const svc = app.get(CampaignsService);
  for (const id of ['1817a791-d30f-42eb-9a88-7cb7dee1592c', '31900fb2-4342-4ba5-988d-98d592344ea8']) {
    const c = await svc.reabrirCena(user.id, id);
    console.log(`cena ${c.ordem} -> ${c.status} (vídeo antigo mantido até o novo render)`);
  }
  await app.close();
})();
