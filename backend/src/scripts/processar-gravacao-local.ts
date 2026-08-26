import 'dotenv/config';
import { copyFile, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basename, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { LiveFaq } from '../modules/live/entities/live-faq.entity';
import { LiveProduct } from '../modules/live/entities/live-product.entity';
import { LiveSession } from '../modules/live/entities/live-session.entity';
import { LiveService } from '../modules/live/live.service';
import { AppUser } from '../modules/users/entities/app-user.entity';

const log = new Logger('ProcessarGravacaoLocal');

/**
 * Transforma uma gravação que está NESTA máquina numa base de conhecimento da
 * conta informada — o mesmo pipeline do upload pela web (ffmpeg → Whisper →
 * Claude), sem passar o arquivo pelo servidor.
 *
 *   npx ts-node src/scripts/processar-gravacao-local.ts <email> <arquivo> [--titulo "..."] [--contexto "..."]
 *
 * TUDO É REAL: o banco apontado por DATABASE_URL, a cobrança de créditos da
 * conta (transcrição por bloco de 10 min + extração) e as chamadas de API.
 * Existe porque subir 170 MB pelo navegador para o servidor processar é mais
 * lento e mais frágil que rodar aqui, e o resultado é idêntico.
 */
function opcao(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const email = (process.argv[2] ?? '').toLowerCase().trim();
  const arquivo = process.argv[3] ? resolve(process.argv[3]) : '';
  if (!email || !arquivo) {
    console.error(
      'Uso: npx ts-node src/scripts/processar-gravacao-local.ts <email> <arquivo> [--titulo "..."] [--contexto "..."]',
    );
    process.exit(1);
  }
  const tamanho = (await stat(arquivo)).size;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const users: Repository<AppUser> = app.get(getRepositoryToken(AppUser));
    const sessoes: Repository<LiveSession> = app.get(getRepositoryToken(LiveSession));
    const produtos: Repository<LiveProduct> = app.get(getRepositoryToken(LiveProduct));
    const faqs: Repository<LiveFaq> = app.get(getRepositoryToken(LiveFaq));
    const live = app.get(LiveService);

    const user = await users.findOneBy({ email });
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);
    log.log(`Conta ${user.email} (${user.plan}), ${user.credits} créditos antes.`);

    const sessao = await live.criarSessao(user.id, {
      title: opcao('titulo') ?? basename(arquivo).replace(/\.[^.]+$/, ''),
      context: opcao('contexto'),
    });
    log.log(`Sessão ${sessao.id} criada. Processando ${(tamanho / 1024 / 1024).toFixed(0)} MB...`);

    // O pipeline apaga o arquivo de entrada ao terminar (é dono do upload).
    // O original do vendedor NÃO é upload: trabalhamos numa cópia temporária.
    const pastaTmp = await mkdtemp(join(tmpdir(), 'pikpok-gravacao-'));
    const copia = join(pastaTmp, basename(arquivo));
    await copyFile(arquivo, copia);
    log.log(`Cópia de trabalho em ${copia} (o original fica intacto).`);

    await live.processarUpload(user.id, sessao.id, {
      path: copia,
      size: tamanho,
      originalname: basename(arquivo),
      mimetype: 'video/mp4',
    } as Express.Multer.File);

    const limite = Date.now() + 60 * 60_000;
    let atual: LiveSession;
    let ultimo = '';
    for (;;) {
      atual = await sessoes.findOneByOrFail({ id: sessao.id });
      if (atual.status !== ultimo) {
        log.log(`status: ${atual.status}`);
        ultimo = atual.status;
      }
      if (atual.status !== 'transcrevendo' && atual.status !== 'extraindo') break;
      if (Date.now() > limite) throw new Error(`Preso em '${atual.status}' por 60 min.`);
      await new Promise((r) => setTimeout(r, 5_000));
    }

    if (atual.status !== 'pronta') {
      throw new Error(`Terminou em '${atual.status}': ${atual.errorMessage ?? '(sem motivo)'}`);
    }
    const [ps, fs, depois] = await Promise.all([
      produtos.find({ where: { liveSessionId: sessao.id }, order: { sourceStartSec: 'ASC' } }),
      faqs.find({ where: { liveSessionId: sessao.id }, order: { createdAt: 'ASC' } }),
      users.findOneByOrFail({ id: user.id }),
    ]);
    log.log(
      `Pronta: ${atual.durationSeconds}s, ${atual.creditsSpent} créditos gastos (saldo ${depois.credits}).`,
    );
    console.log(`\nSESSÃO: ${sessao.id}\n\nPRODUTOS (${ps.length}):`);
    for (const p of ps) {
      console.log(
        `- ${p.name} | R$ ${p.priceBrl ?? '—'} | conf ${p.confidence} | ${p.sourceStartSec}s\n    ${p.details ?? ''}`,
      );
    }
    console.log(`\nFAQ (${fs.length}):`);
    for (const f of fs) console.log(`- [${f.kind}] ${f.question}\n    → ${f.answer}`);
    console.log(`\nTRANSCRIÇÃO (${atual.transcript?.length ?? 0} chars):\n${atual.transcript ?? ''}`);
  } finally {
    await app.close();
  }
}

void main().catch((e) => {
  log.error(e instanceof Error ? e.stack : String(e));
  process.exitCode = 1;
});
