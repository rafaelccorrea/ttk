import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AuthService } from '../../modules/auth/auth.service';

/**
 * Gestão da lista de espera do soft launch.
 *
 *   npm run waitlist            -> mostra o status da fila
 *   npm run waitlist:release 50 -> libera os 50 mais antigos (envia o e-mail)
 *
 * O release respeita a ordem de entrada e envia um e-mail por vez, com pausa
 * entre eles: SMTP compartilhado costuma cortar rajadas, e um lote inteiro
 * classificado como spam custa mais caro do que a demora.
 */
async function main() {
  const arg = process.argv[2];
  const limit = arg ? Number(arg) : 0;

  if (arg && (!Number.isInteger(limit) || limit <= 0)) {
    console.error(`Quantidade inválida: "${arg}". Use um inteiro positivo.`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const auth = app.get(AuthService);
    const status = await auth.waitlistStatus();

    console.log('--- Lista de espera ---');
    console.log(`  aguardando:     ${status.waiting}`);
    console.log(`  liberados:      ${status.released}`);
    console.log(`  confirmados:    ${status.confirmed}`);

    if (!limit) {
      console.log('\nPara liberar: npm run waitlist:release <quantidade>');
      return;
    }

    if (!status.waiting) {
      console.log('\nNinguém na fila — nada a liberar.');
      return;
    }

    console.log(`\nLiberando ${Math.min(limit, status.waiting)}...\n`);
    const result = await auth.releaseWaitlist(limit, (email, ok, erro) =>
      console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${email}${erro ? ` — ${erro}` : ''}`),
    );
    console.log(
      `\nEnviados: ${result.sent}. Falhas: ${result.failed}. Restam na fila: ${result.remaining}.`,
    );
    if (result.failed) {
      console.log('Quem falhou continua na fila e entra no próximo lote.');
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
