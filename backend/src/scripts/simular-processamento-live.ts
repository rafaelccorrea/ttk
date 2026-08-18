import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { FfmpegRunner } from '../common/media/ffmpeg-runner';
import { AiService, BaseDeConhecimento } from '../modules/studio/ai.service';
import { TranscriptionService } from '../modules/studio/transcription.service';
import { LiveService } from '../modules/live/live.service';
import { LiveFaq } from '../modules/live/entities/live-faq.entity';
import { LiveProduct } from '../modules/live/entities/live-product.entity';
import { LiveSession } from '../modules/live/entities/live-session.entity';
import { AppUser } from '../modules/users/entities/app-user.entity';

const log = new Logger('SimularProcessamentoLive');

/**
 * O pipeline de processamento de uma live, de ponta a ponta —
 * `npm run simular:processamento-live`.
 *
 * POR QUE ISTO EXISTE. Uma live morreu em produção com
 * `invalid input syntax for type integer: "879.57"`, e o ponto doloroso não foi
 * o bug: foi ONDE ele aparecia. O ffmpeg mede duração em fração de segundo, as
 * colunas `live_sessions.duration_seconds` e `live_products.source_start_sec`
 * são `int`, e nada no caminho reclamava — o erro só estourava no ÚLTIMO passo,
 * depois da live inteira transcrita e cobrada. O teste unitário prova o
 * arredondamento; só a travessia completa prova que o número atravessa o ffmpeg
 * real, o pipeline real e o Postgres real sem quebrar no fim.
 *
 * O QUE É REAL: o ffmpeg (gera e mede o arquivo), o `AudioChunkerService`
 * inteiro — extração, fatiamento, medição —, o `LiveService`, a cobrança de
 * créditos e o Postgres, com as colunas `int` de verdade recebendo os valores.
 *
 * O QUE É DUBLADO, e por quê: o Whisper e o Claude. Os dois custam dinheiro por
 * execução e são não determinísticos — e nenhum dos dois participa do bug, que
 * é aritmético. O dublê do Whisper devolve texto fixo; o do Claude devolve, de
 * propósito, um produto com `inicioSec` FRACIONÁRIO, que é exatamente a forma
 * que derrubava o `INSERT`.
 *
 * CUSTO: zero em API. Gasta alguns segundos de CPU no ffmpeg e escreve numa
 * conta descartável, apagada no fim mesmo quando algo falha.
 */

const EMAIL_DA_SIMULACAO = 'simulacao-processamento-live@pikpok.local';

/**
 * A duração do arquivo de teste, em segundos.
 *
 * É o número do erro real, e ele é escolhido a dedo: 879.57s são 14min39 — mais
 * que o piso de 10 min que o pipeline exige, menos que os 15 min de uma fatia
 * (então a travessia é rápida), e com casa decimal, que é o ponto inteiro.
 */
const DURACAO_DO_ARQUIVO = 879.57;

/** O que o dublê do Whisper devolve. Precisa parecer live, e nada além disso. */
const TRANSCRICAO_FALSA = [
  'Gente, olha essa blusa de tricô, ela tá saindo por oitenta e nove e noventa.',
  'Tem na cor rosa e na cor bege, e o frete é grátis acima de noventa e nove reais.',
].join(' ');

/**
 * Um MP4 de verdade, com vídeo, som e duração quebrada.
 *
 * Precisa ter as duas trilhas: o chunker recusa arquivo sem vídeo ("isto é só
 * áudio") e sem áudio ("esta gravação não tem som"), e as duas recusas moram
 * justamente no caminho que esta simulação quer atravessar. `lavfi` gera as
 * duas do nada, e a 2 fps o encode de 14 minutos leva poucos segundos.
 */
async function gerarGravacao(ffmpeg: FfmpegRunner, pasta: string): Promise<string> {
  const caminho = join(pasta, 'live-sintetica.mp4');
  await ffmpeg.rodar(
    [
      '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=320x240:r=2:d=${DURACAO_DO_ARQUIVO}`,
      '-f', 'lavfi', '-i', `anullsrc=r=16000:cl=mono:d=${DURACAO_DO_ARQUIVO}`,
      '-t', String(DURACAO_DO_ARQUIVO),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '16k',
      '-shortest',
      caminho,
    ],
    5 * 60_000,
  );
  return caminho;
}

/** Espera a sessão sair de 'transcrevendo'/'extraindo'. */
async function esperarFim(
  sessoes: Repository<LiveSession>,
  sessionId: string,
  tetoMs = 10 * 60_000,
): Promise<LiveSession> {
  const limite = Date.now() + tetoMs;
  for (;;) {
    const sessao = await sessoes.findOneByOrFail({ id: sessionId });
    if (sessao.status !== 'transcrevendo' && sessao.status !== 'extraindo') {
      return sessao;
    }
    if (Date.now() > limite) {
      throw new Error(
        `A sessão ficou presa em '${sessao.status}' por mais de ${tetoMs / 60_000} minutos.`,
      );
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const users = app.get<Repository<AppUser>>(getRepositoryToken(AppUser));
  const sessoes = app.get<Repository<LiveSession>>(getRepositoryToken(LiveSession));
  const produtos = app.get<Repository<LiveProduct>>(getRepositoryToken(LiveProduct));
  const faqs = app.get<Repository<LiveFaq>>(getRepositoryToken(LiveFaq));
  const ffmpeg = app.get(FfmpegRunner);
  const live = app.get(LiveService);

  if (!ffmpeg.enabled) {
    throw new Error(
      'Sem ffmpeg neste ambiente: esta simulação é justamente sobre o que o ffmpeg mede.',
    );
  }

  /*
   * Os dublês entram por cima das instâncias JÁ injetadas no LiveService — é o
   * mesmo objeto que ele guardou, então trocar o método aqui troca para ele.
   * `isConfigured` e `enabled` são getters de protótipo e o pipeline os checa
   * antes de começar; sem chave de API neste ambiente eles diriam não e a
   * simulação morreria na porta.
   */
  const transcricao = app.get(TranscriptionService);
  Object.defineProperty(transcricao, 'isConfigured', { get: () => true });
  (transcricao as unknown as Record<string, unknown>).transcribeBuffer =
    async () => ({ transcript: TRANSCRICAO_FALSA });

  const ai = app.get(AiService);
  Object.defineProperty(ai, 'enabled', { get: () => true });
  /*
   * O `inicioSec` fracionário é o ponto do teste, não um detalhe do dublê. Em
   * produção ele nasce da SOMA das durações de fatia medidas pelo ffmpeg, e é
   * ele que ia direto para `source_start_sec`, que é `int`.
   */
  (ai as unknown as Record<string, unknown>).extrairConhecimentoDaLive =
    async (bloco: { inicioSec: number }) => [
      {
        nome: 'Blusa de tricô',
        precoBrl: 89.9,
        variantes: ['rosa', 'bege'],
        frete: 'Frete grátis acima de R$ 99',
        promo: null,
        aliases: ['a blusinha'],
        confianca: 0.92,
        inicioSec: bloco.inicioSec + 12.37,
      },
    ];
  (ai as unknown as Record<string, unknown>).consolidarConhecimento = async (
    candidatos: BaseDeConhecimento['produtos'],
  ): Promise<BaseDeConhecimento> => ({
    produtos: candidatos,
    faq: [
      {
        pergunta: 'Qual o prazo de entrega?',
        resposta: 'De 5 a 10 dias úteis.',
        tipo: 'faq' as const,
      },
    ],
  });

  const pasta = await mkdtemp(join(tmpdir(), 'pikpok-sim-live-'));
  const problemas: string[] = [];
  let userId = '';

  try {
    /* ------------------------------------------------- o arquivo de verdade */
    log.log(`Gerando um MP4 de ${DURACAO_DO_ARQUIVO}s com o ffmpeg...`);
    const gravacao = await gerarGravacao(ffmpeg, pasta);
    const tamanho = (await stat(gravacao)).size;
    const medida = await ffmpeg.duracao(gravacao);
    log.log(
      `Arquivo pronto: ${(tamanho / 1024 / 1024).toFixed(1)}MB, ffmpeg mediu ${medida}s.`,
    );
    if (medida !== null && Number.isInteger(medida)) {
      problemas.push(
        `O arquivo saiu com duração inteira (${medida}s): sem casa decimal, esta simulação não exercita o bug que ela existe para pegar.`,
      );
    }

    /* -------------------------------------------------- a conta e a sessão */
    await users.delete({ email: EMAIL_DA_SIMULACAO });
    const conta = await users.save(
      users.create({
        // Como em `simular-live`: o id de app_users é o `sub` do Supabase em
        // produção, então a simulação cunha o próprio.
        id: randomUUID(),
        email: EMAIL_DA_SIMULACAO,
        plan: 'business',
        credits: 10_000,
      }),
    );
    userId = conta.id;
    const sessao = await live.criarSessao(userId, { title: 'Live sintética' });
    log.log(`Conta ${userId} e sessão ${sessao.id} criadas.`);

    /* ----------------------------------------------- o pipeline de verdade */
    await live.processarUpload(userId, sessao.id, {
      path: gravacao,
      size: tamanho,
      originalname: 'live-sintetica.mp4',
      mimetype: 'video/mp4',
    } as Express.Multer.File);

    log.log('Upload aceito; o pipeline roda em background. Aguardando...');
    const fim = await esperarFim(sessoes, sessao.id);

    /* ------------------------------------------------------- o que conferir */
    if (fim.status !== 'pronta') {
      problemas.push(
        `A sessão terminou em '${fim.status}' em vez de 'pronta'. Motivo: ${fim.errorMessage ?? '(nenhum registrado)'}`,
      );
    }
    if (fim.durationSeconds === null) {
      problemas.push('A duração não foi gravada; era para o ffmpeg tê-la medido.');
    } else if (!Number.isInteger(fim.durationSeconds)) {
      problemas.push(
        `duration_seconds saiu fracionário (${fim.durationSeconds}) — é a coluna int que quebrava.`,
      );
    } else {
      log.log(`duration_seconds = ${fim.durationSeconds} (inteiro, como a coluna exige).`);
    }

    const salvos = await produtos.find({ where: { liveSessionId: sessao.id } });
    if (salvos.length === 0) {
      problemas.push('Nenhum produto gravado: a base saiu vazia.');
    }
    for (const p of salvos) {
      if (p.sourceStartSec !== null && !Number.isInteger(p.sourceStartSec)) {
        problemas.push(
          `source_start_sec de "${p.name}" saiu fracionário (${p.sourceStartSec}).`,
        );
      }
    }
    if (salvos.length) {
      log.log(
        `${salvos.length} produto(s) gravado(s); source_start_sec = ${salvos
          .map((p) => p.sourceStartSec)
          .join(', ')}.`,
      );
    }

    const faqSalvo = await faqs.count({ where: { liveSessionId: sessao.id } });
    log.log(`${faqSalvo} item(ns) de FAQ gravado(s).`);
  } finally {
    /* ------------------------------------------------------------ limpeza */
    /*
     * A sessão sai ANTES da conta, e explicitamente.
     *
     * Produtos e FAQ têm CASCADE para `live_sessions`, mas `live_sessions` NÃO
     * tem cascade a partir de `app_users`: apagar só a conta deixava a sessão
     * de teste viva no banco, órfã e invisível — foi o que aconteceu na
     * primeira execução desta simulação, contra o banco de produção.
     */
    if (userId) {
      await sessoes.delete({ userId }).catch(() => undefined);
      await users.delete({ id: userId }).catch(() => undefined);
    }
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
    await app.close();
  }

  if (problemas.length) {
    log.error(`A simulação encontrou ${problemas.length} problema(s):`);
    problemas.forEach((p) => log.error(`  - ${p}`));
    process.exitCode = 1;
    return;
  }
  log.log('Pipeline atravessado de ponta a ponta, sem nada fracionário no banco.');
}

void run().catch((error) => {
  log.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
