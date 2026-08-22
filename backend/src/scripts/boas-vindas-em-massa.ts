import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { IsNull, Not, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from '../app.module';
import { MailService } from '../modules/auth/mail.service';
import { AppUser } from '../modules/users/entities/app-user.entity';

/**
 * Envia o e-mail de boas-vindas para quem já tem conta ativa (e-mail
 * confirmado). Pensado para o disparo único de lançamento do template novo.
 *
 *   npx ts-node src/scripts/boas-vindas-em-massa.ts            -> só lista quem receberia
 *   npx ts-node src/scripts/boas-vindas-em-massa.ts --enviar   -> envia de verdade
 *   npx ts-node src/scripts/boas-vindas-em-massa.ts --enviar --so=a@b.com,c@d.com
 *
 * Um e-mail por vez com pausa entre eles — SMTP compartilhado corta rajadas e
 * um lote marcado como spam custa mais do que a demora. Quem está na fila de
 * espera sem confirmar fica de fora: ainda não entrou no produto.
 */
const PAUSA_MS = 400;

async function main() {
  const enviar = process.argv.includes('--enviar');
  const so = process.argv.find((a) => a.startsWith('--so='))?.slice(5);
  const filtro = so ? new Set(so.split(',').map((e) => e.trim().toLowerCase())) : null;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const mail = app.get(MailService);

    let alvo = await users.find({
      where: { emailConfirmedAt: Not(IsNull()) },
      order: { emailConfirmedAt: 'ASC' },
    });
    if (filtro) alvo = alvo.filter((u) => filtro.has(u.email.toLowerCase()));

    console.log(`Destino: ${process.env.APP_URL ?? '(APP_URL não definido)'}`);
    console.log(`SMTP:    ${process.env.SMTP_HOST ?? '(sem SMTP_HOST — Ethereal, NÃO entrega de verdade)'}`);
    console.log(`Contas com e-mail confirmado: ${alvo.length}\n`);
    for (const u of alvo) console.log(`  ${u.email}${u.displayName ? ` — ${u.displayName}` : ''}`);

    if (!enviar) {
      console.log('\nModo de verificação. Para disparar: --enviar');
      return;
    }

    console.log('\nEnviando...\n');
    let ok = 0;
    let falha = 0;
    for (const u of alvo) {
      try {
        const r = await mail.sendWelcomeEmail(u.email, u.displayName);
        ok++;
        console.log(`  OK    ${u.email}${r.previewUrl ? ` — ${r.previewUrl}` : ''}`);
      } catch (err) {
        falha++;
        console.log(`  FALHA ${u.email} — ${err instanceof Error ? err.message : String(err)}`);
      }
      await new Promise((r) => setTimeout(r, PAUSA_MS));
    }
    console.log(`\nEnviados: ${ok}. Falhas: ${falha}.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
