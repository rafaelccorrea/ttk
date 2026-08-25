import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { ACTION_PRICES } from '../modules/billing/billing.config';
import { BillingService } from '../modules/billing/billing.service';
import { LiveFaq } from '../modules/live/entities/live-faq.entity';
import { LiveProduct } from '../modules/live/entities/live-product.entity';
import { LiveSession } from '../modules/live/entities/live-session.entity';
import { LiveService } from '../modules/live/live.service';
import { AppUser } from '../modules/users/entities/app-user.entity';

const log = new Logger('ExtrairDaTranscricao');

/**
 * Retoma SÓ a extração de uma sessão que já tem a transcrição salva — o caso
 * de "transcreveu, mas a cobrança da extração falhou" (crédito acabou no meio).
 *
 *   npx ts-node src/scripts/extrair-da-transcricao.ts <sessionId>
 *
 * Cobra apenas `live_extract`; a transcrição já foi paga. A transcrição salva é
 * a junção das fatias por linha em branco dupla, e as fatias têm 15 min: é
 * assim que os trechos são reconstruídos com o offset aproximado.
 */
const SEGUNDOS_POR_FATIA = 15 * 60;

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error('Uso: npx ts-node src/scripts/extrair-da-transcricao.ts <sessionId>');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const sessoes: Repository<LiveSession> = app.get(getRepositoryToken(LiveSession));
    const produtos: Repository<LiveProduct> = app.get(getRepositoryToken(LiveProduct));
    const faqs: Repository<LiveFaq> = app.get(getRepositoryToken(LiveFaq));
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const live = app.get(LiveService) as unknown as {
      extrairBase: LiveService['extrairBase'];
      gravarBase: LiveService['gravarBase'];
    };
    const billing = app.get(BillingService);

    const sessao = await sessoes.findOneByOrFail({ id: sessionId });
    if (!sessao.transcript?.trim()) throw new Error('Sessão sem transcrição salva.');
    if (sessao.status === 'pronta') throw new Error('Sessão já está pronta.');

    const trechos = sessao.transcript
      .split(/\n\n+/)
      .map((texto, i) => ({ texto, inicioSec: i * SEGUNDOS_POR_FATIA, duracaoSec: SEGUNDOS_POR_FATIA }));
    log.log(`${trechos.length} trecho(s) reconstruído(s); cobrando live_extract...`);

    await sessoes.update({ id: sessionId }, { status: 'extraindo', processingStartedAt: new Date(), errorMessage: null });
    await billing.charge(sessao.userId, 'live_extract', 1);
    try {
      const base = await live.extrairBase(trechos);
      if (!base.produtos.length && !base.faq.length) throw new Error('Extração voltou vazia.');
      await live.gravarBase(sessao.userId, sessionId, base.produtos, base.faq);
      await sessoes.update(
        { id: sessionId },
        {
          status: 'pronta',
          processingStartedAt: null,
          errorMessage: null,
          creditsSpent: sessao.creditsSpent + ACTION_PRICES.live_extract.credits,
        },
      );
    } catch (e) {
      await billing.refund(sessao.userId, 'live_extract', 'extração retomada falhou').catch(() => undefined);
      await sessoes.update({ id: sessionId }, { status: 'erro', processingStartedAt: null, errorMessage: String((e as Error).message) });
      throw e;
    }

    const [ps, fs, u] = await Promise.all([
      produtos.find({ where: { liveSessionId: sessionId }, order: { sourceStartSec: 'ASC' } }),
      faqs.find({ where: { liveSessionId: sessionId }, order: { createdAt: 'ASC' } }),
      users.findOneByOrFail({ id: sessao.userId }),
    ]);
    log.log(`Pronta. Saldo da conta: ${u.credits} créditos.`);
    console.log(`\nPRODUTOS (${ps.length}):`);
    for (const p of ps) console.log(`- ${p.name} | R$ ${p.priceBrl ?? '—'} | conf ${p.confidence}\n    ${p.details ?? ''}`);
    console.log(`\nFAQ (${fs.length}):`);
    for (const f of fs) console.log(`- [${f.kind}] ${f.question}\n    → ${f.answer}`);
  } finally {
    await app.close();
  }
}

void main().catch((e) => {
  log.error(e instanceof Error ? e.stack : String(e));
  process.exitCode = 1;
});
