import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, LessThan, Repository } from 'typeorm';
import { FfmpegRunner, OpcoesDeCorte, PontoDeRosto } from '../../common/media/ffmpeg-runner';
import {
  ACTION_PRICES,
  BillableAction,
  TRANSCRIBE_BLOCK_MINUTES,
} from '../billing/billing.config';
import { BillingService } from '../billing/billing.service';
import { FAIXAS } from '../combinations/clip-timing';
import { CombinationsService } from '../combinations/combinations.service';
import { ClipRole } from '../combinations/entities/combination-clip.entity';
import { AudioChunkerService } from '../live/audio-chunker.service';
import { MEDIA_ROUTE, MediaMirrorService } from '../media/media-mirror.service';
import { AiService } from '../studio/ai.service';
import { TranscriptionService } from '../studio/transcription.service';
import {
  blocosDeTranscricao,
  CutFormat,
  CutMode,
  LIMITES,
  planejarRapido,
  SegmentoDeFala,
  srtDoTrecho,
  TrechoPlanejado,
  validarSugestoes,
} from './cut-planner';
import { CutClip } from './entities/cut-clip.entity';
import { CutJob } from './entities/cut-job.entity';
import { CreateCutJobDto, CreateCutJobFromUrlDto } from './dto/create-cut-job.dto';
import { FaceTrackerService } from './face-tracker.service';
import { VideoDownloaderService } from './video-downloader.service';

/**
 * Um job de cortes por vez neste processo.
 *
 * A fila do ffmpeg já é serial (LVE da hospedagem compartilhada); dois jobs
 * "em paralelo" só intercalariam cortes e atrasariam os dois. E cada job
 * segura o Multiplicador enquanto roda — dois segurariam o dobro.
 */
const MAX_JOBS_SIMULTANEOS = 1;

/** Sem batimento por este tempo, o cron considera o job morto e estorna. */
const MINUTOS_ATE_CONSIDERAR_TRAVADO = 15;
const INTERVALO_DE_BATIMENTO_MS = 60_000;

/** Teto por corte: 90 s em 720p `veryfast` leva bem menos que isto. */
const TIMEOUT_POR_CORTE_MS = 4 * 60_000;

/** Segundos por fatia de áudio na transcrição (o padrão do chunker é 15 min). */
const SEGUNDOS_POR_FATIA = 900;

const PREFIXO_S3 = 'cuts';

/** Mesmo teto do upload (2 GB): um link não pode trazer mais do que um arquivo. */
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

@Injectable()
export class CutsService {
  private readonly logger = new Logger(CutsService.name);
  /** Jobs cujo pipeline está vivo NESTE processo (segunda barreira do cron). */
  private readonly emAndamento = new Set<string>();
  /**
   * Jobs que o usuário pediu para cancelar. O cancelamento é cooperativo: o
   * pipeline olha este conjunto nos pontos seguros (depois do download, depois
   * do planejamento e antes de cada corte) e para ali — um ffmpeg no meio não
   * é interrompido, porque o corte já foi cobrado e vale mais entregue.
   */
  private readonly cancelados = new Set<string>();

  constructor(
    @InjectRepository(CutJob) private readonly jobs: Repository<CutJob>,
    @InjectRepository(CutClip) private readonly clips: Repository<CutClip>,
    private readonly dataSource: DataSource,
    private readonly billing: BillingService,
    private readonly ffmpeg: FfmpegRunner,
    private readonly chunker: AudioChunkerService,
    private readonly transcricao: TranscriptionService,
    private readonly ai: AiService,
    private readonly mirror: MediaMirrorService,
    private readonly combinations: CombinationsService,
    private readonly faces: FaceTrackerService,
    private readonly downloader: VideoDownloaderService,
  ) {}

  /** O que a tela precisa saber antes de mostrar opções (aba de link, rosto). */
  capacidades() {
    return {
      urlImport: this.downloader.enabled,
      faceTracking: this.faces.enabled,
    };
  }

  // ----------------------------------------------------------------- cotação

  /**
   * Quanto vai custar, em créditos, ANTES de enviar.
   *
   * `durationSeconds` é a duração lida pelo navegador; só importa no modo
   * inteligente (blocos de transcrição). A cobrança real usa a duração medida
   * pelo ffmpeg, então isto é estimativa — e a tela diz isso.
   */
  cotar(mode: CutMode, quantity: number, durationSeconds?: number) {
    const acao: BillableAction = mode === 'inteligente' ? 'cut_ai' : 'cut';
    const porCorte = ACTION_PRICES[acao].credits;
    const cortes = porCorte * quantity;
    const blocos =
      mode === 'inteligente'
        ? blocosDeTranscricao(Math.max(0, durationSeconds ?? 0), TRANSCRIBE_BLOCK_MINUTES)
        : 0;
    const transcricao = blocos * ACTION_PRICES.transcribe.credits;
    return {
      mode,
      quantity,
      porCorte,
      cortes,
      blocosDeTranscricao: blocos,
      transcricao,
      total: cortes + transcricao,
      limites: LIMITES,
    };
  }

  // ------------------------------------------------------------------ leitura

  async listar(userId: string) {
    const lista = await this.jobs.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const ids = lista.map((j) => j.id);
    const prontos = ids.length
      ? await this.clips
          .createQueryBuilder('c')
          .select('c.jobId', 'jobId')
          .addSelect('COUNT(*)', 'total')
          .addSelect(`SUM(CASE WHEN c.status = 'pronto' THEN 1 ELSE 0 END)`, 'prontos')
          .where('c.jobId IN (:...ids)', { ids })
          .groupBy('c.jobId')
          .getRawMany<{ jobId: string; total: string; prontos: string }>()
      : [];
    const porJob = new Map(prontos.map((p) => [p.jobId, p]));
    return lista.map((j) => ({
      ...this.publico(j),
      clipsTotal: Number(porJob.get(j.id)?.total ?? 0),
      clipsProntos: Number(porJob.get(j.id)?.prontos ?? 0),
    }));
  }

  async detalhe(userId: string, id: string) {
    const job = await this.achar(userId, id);
    const clips = await this.clips.find({
      where: { jobId: id },
      order: { position: 'ASC' },
    });
    return { ...this.publico(job), clips };
  }

  async apagar(userId: string, id: string): Promise<void> {
    const job = await this.achar(userId, id);
    if (this.emAndamento.has(id) || job.status === 'processando') {
      throw new ConflictException('Este job ainda está sendo processado. Aguarde terminar.');
    }
    const clips = await this.clips.find({ where: { jobId: id } });
    const prefixo = `${MEDIA_ROUTE}/`;
    for (const c of clips) {
      if (c.url?.startsWith(prefixo)) {
        await this.mirror.deleteObject(c.url.slice(prefixo.length));
      }
    }
    if (job.sourcePath) await unlink(job.sourcePath).catch(() => undefined);
    await this.jobs.delete({ id, userId });
  }

  /**
   * Cancela um job em processamento: o que ainda não foi gerado é estornado;
   * os cortes já prontos ficam. Se o pipeline está vivo neste processo, ele
   * para no próximo ponto seguro; se não está (o servidor reiniciou), o job
   * é um órfão e resolve-se na hora, como o cron faria.
   */
  async cancelar(userId: string, id: string): Promise<void> {
    const job = await this.achar(userId, id);
    if (job.status !== 'processando') {
      throw new ConflictException('Este job já terminou; não há o que cancelar.');
    }
    if (this.emAndamento.has(id)) {
      this.cancelados.add(id);
      return;
    }
    await this.estornarPendentes(id, 'Cortes: cancelado a pedido');
    if (job.sourcePath) await unlink(job.sourcePath).catch(() => undefined);
    await this.jobs.update(
      { id },
      {
        status: 'falhou',
        processingStartedAt: null,
        sourcePath: null,
        error: 'Cancelado a pedido. Os créditos dos cortes não gerados foram devolvidos.',
      },
    );
  }

  private checarCancelamento(id: string): void {
    if (this.cancelados.has(id)) {
      throw new Error('Cancelado a pedido. Os créditos dos cortes não gerados foram devolvidos.');
    }
  }

  // ------------------------------------------------------------------- upload

  async criar(userId: string, dto: CreateCutJobDto, file: Express.Multer.File) {
    const caminho = file?.path;
    try {
      if (!caminho || !file.size) {
        throw new BadRequestException('Envie o vídeo que você quer cortar.');
      }
      await this.validarPedido(userId, dto);
      return await this.abrirJob(userId, dto, {
        sourceName: (file.originalname || 'video.mp4').slice(0, 255),
        sourcePath: caminho,
        sourceUrl: null,
      });
    } catch (error) {
      if (caminho) await unlink(caminho).catch(() => undefined);
      throw error;
    }
  }

  /** O que a tela mostra antes de confirmar um link: título, duração, capa e se cabe. */
  async inspecionarLink(url: string) {
    if (!this.downloader.enabled) {
      throw new BadRequestException('Importar por link está desligado neste servidor.');
    }
    const info = await this.downloader.inspecionar(url);
    const dur = info.duracaoSeg;
    const cabe = dur === null || (dur >= LIMITES.fonteMinSeg && dur <= LIMITES.fonteMaxSeg);
    return {
      ...info,
      cabe,
      motivo: cabe
        ? null
        : `O vídeo tem ${formatarDuracao(dur as number)}; os cortes aceitam de ${LIMITES.fonteMinSeg / 60} a ${LIMITES.fonteMaxSeg / 60} minutos.`,
    };
  }

  /**
   * Job a partir de um link. Responde na hora; o download acontece no
   * pipeline (o loader mostra "Carregando seu vídeo" enquanto isso). A
   * duração informada pelo site é conferida aqui para não abrir job de 3 h;
   * a medida de verdade continua sendo a do ffmpeg, depois do download.
   */
  async criarPorUrl(userId: string, dto: CreateCutJobFromUrlDto) {
    await this.validarPedido(userId, dto);
    const info = await this.inspecionarLink(dto.url);
    if (!info.cabe) throw new BadRequestException(info.motivo as string);
    return this.abrirJob(userId, dto, {
      sourceName: info.titulo || 'video',
      sourcePath: null,
      sourceUrl: dto.url,
    });
  }

  /** Regras comuns a upload e link — tudo o que pode ser recusado antes de gastar disco. */
  private async validarPedido(userId: string, dto: CreateCutJobDto): Promise<void> {
    {
      if (dto.minSeconds > dto.maxSeconds) {
        throw new BadRequestException('A duração mínima do corte não pode passar da máxima.');
      }
      if (!this.ffmpeg.enabled) {
        throw new BadRequestException(
          'Cortes indisponíveis: o ffmpeg não está instalado neste ambiente.',
        );
      }
      if (dto.mode === 'inteligente') {
        if (!this.transcricao.isConfigured) {
          throw new BadRequestException(
            'Modo inteligente indisponível: a transcrição não está configurada. Use o modo rápido.',
          );
        }
        if (!this.ai.enabled) {
          throw new BadRequestException(
            'Modo inteligente indisponível: a IA não está configurada. Use o modo rápido.',
          );
        }
      }
      if (!this.mirror.enabled) {
        throw new BadRequestException(
          'Cortes indisponíveis: o armazenamento de vídeo não está configurado.',
        );
      }
      if (this.emAndamento.size >= MAX_JOBS_SIMULTANEOS) {
        throw new ConflictException(
          'Já há um vídeo sendo cortado agora. Aguarde ele terminar para enviar outro.',
        );
      }

      /*
       * Saldo conferido AQUI, com o piso do pedido; o débito fica no pipeline,
       * depois que o ffmpeg mede a duração (que define os blocos de
       * transcrição). Quem tem zero crédito descobre agora, não depois de
       * esperar o processamento — e o arquivo dele não é a causa.
       */
      const acao: BillableAction = dto.mode === 'inteligente' ? 'cut_ai' : 'cut';
      await this.billing.assertSaldo(userId, [
        { action: acao, quantidade: dto.quantity },
        ...(dto.mode === 'inteligente'
          ? [{ action: 'transcribe' as BillableAction, quantidade: 1 }]
          : []),
      ]);
    }
  }

  private async abrirJob(
    userId: string,
    dto: CreateCutJobDto,
    fonte: { sourceName: string; sourcePath: string | null; sourceUrl: string | null },
  ) {
    const job = await this.jobs.save(
      this.jobs.create({
        userId,
        status: 'processando',
        mode: dto.mode,
        format: dto.format ?? '9:16',
        // Legenda vem da transcrição; sem ela (modo rápido) não há o que queimar.
        captions: dto.mode === 'inteligente' && Boolean(dto.captions),
        captionStyle: dto.captionStyle ?? 'classico',
        reframe: dto.reframe ?? 'rosto',
        quantity: dto.quantity,
        minSeconds: dto.minSeconds,
        maxSeconds: dto.maxSeconds,
        sourceName: fonte.sourceName.slice(0, 255),
        sourcePath: fonte.sourcePath,
        sourceUrl: fonte.sourceUrl,
        processingStartedAt: new Date(),
      }),
    );

    this.emAndamento.add(job.id);
    void this.executar(job).catch((error) => {
      this.logger.error(`Pipeline de cortes ${job.id} falhou: ${error}`);
    });
    return this.publico(job);
  }

  // ----------------------------------------------------------------- pipeline

  private async executar(job: CutJob): Promise<void> {
    const { id, userId } = job;
    let fonte = job.sourcePath as string;
    // Pasta própria quando a fonte vem por link — apagada inteira no fim.
    let pastaDoDownload: string | null = null;
    const batimento = setInterval(() => {
      void this.jobs
        .update({ id }, { processingStartedAt: new Date() })
        .catch((e) => this.logger.warn(`Batimento do job ${id} falhou: ${e}`));
    }, INTERVALO_DE_BATIMENTO_MS);

    try {
      // 0. Fonte por link: baixa primeiro. O batimento já está rodando, então
      // um download de 20 min não vira "job travado" para o cron.
      if (!fonte && job.sourceUrl) {
        pastaDoDownload = join(tmpdir(), 'pikpok-cuts-uploads', id);
        await mkdir(pastaDoDownload, { recursive: true });
        fonte = await this.downloader.baixar(job.sourceUrl, pastaDoDownload, MAX_DOWNLOAD_BYTES);
        job.sourcePath = fonte;
        await this.jobs.update({ id }, { sourcePath: fonte });
      }
      if (!fonte) throw new Error('Este job não tem vídeo de origem.');

      // 1. O arquivo é vídeo mesmo? Quanto dura?
      const streams = await this.ffmpeg.streamsDe(fonte);
      if (!streams.sondou) {
        throw new Error(
          'Não consegui abrir o processador de vídeo agora — o servidor estava sobrecarregado. Envie de novo em alguns minutos.',
        );
      }
      if (!streams.legivel || !streams.video) {
        throw new Error(
          'Não consegui ler este arquivo como vídeo. Envie um MP4, MOV, MKV ou WEBM e confira se o envio terminou.',
        );
      }
      if (job.mode === 'inteligente' && !streams.audio) {
        throw new Error(
          'Este vídeo não tem áudio, e o modo inteligente escolhe os trechos pela fala. Use o modo rápido.',
        );
      }
      const duracao = await this.ffmpeg.duracao(fonte);
      if (!duracao) {
        throw new Error('Não consegui medir a duração do vídeo. Tente exportá-lo de novo em MP4.');
      }
      if (duracao < LIMITES.fonteMinSeg || duracao > LIMITES.fonteMaxSeg) {
        throw new Error(
          `O vídeo tem ${formatarDuracao(duracao)}; os cortes aceitam de ${LIMITES.fonteMinSeg / 60} a ${LIMITES.fonteMaxSeg / 60} minutos.`,
        );
      }
      const duracaoInt = Math.ceil(duracao);
      job.sourceDurationSeconds = duracaoInt;

      // 2. Cobra — débito e marcadores na MESMA transação (ver billing.charge).
      const acao: BillableAction = job.mode === 'inteligente' ? 'cut_ai' : 'cut';
      const blocos =
        job.mode === 'inteligente'
          ? blocosDeTranscricao(duracaoInt, TRANSCRIBE_BLOCK_MINUTES)
          : 0;
      await this.dataSource.transaction(async (m) => {
        await this.billing.charge(userId, acao, job.quantity, m, undefined, false);
        if (blocos) await this.billing.charge(userId, 'transcribe', blocos, m, undefined, false);
        await m.getRepository(CutJob).update(
          { id },
          {
            sourceDurationSeconds: duracaoInt,
            pendingCutCharges: job.quantity,
            pendingTranscribeBlocks: blocos,
          },
        );
      });

      // 3. Planeja os trechos.
      let trechos: TrechoPlanejado[];
      let fala: SegmentoDeFala[] = [];
      if (job.mode === 'inteligente') {
        ({ trechos, fala } = await this.planejarInteligente(job, fonte, duracao));
        // Blocos consumidos: a transcrição aconteceu, não há o que devolver.
        await this.jobs.update({ id }, { pendingTranscribeBlocks: 0 });
      } else {
        const silencios = streams.audio ? await this.ffmpeg.silencios(fonte) : [];
        trechos = planejarRapido(duracao, job.quantity, job.minSeconds, job.maxSeconds, silencios);
      }
      trechos.sort((a, b) => a.inicio - b.inicio);

      // Cortes que não couberam (fonte curta, IA + rápido não completaram):
      // devolve a diferença antes de começar a gastar CPU.
      const faltantes = job.quantity - trechos.length;
      if (faltantes > 0) {
        await this.billing.refund(userId, acao, 'Cortes: o vídeo não rendeu todos os cortes pedidos', faltantes);
        await this.jobs.decrement({ id }, 'pendingCutCharges', faltantes);
      }
      if (!trechos.length) {
        throw new Error('Não encontrei nenhum trecho que caiba na faixa de duração pedida.');
      }

      const registros = await this.clips.save(
        trechos.map((t, i) =>
          this.clips.create({
            jobId: id,
            userId,
            position: i + 1,
            startSeconds: t.inicio,
            endSeconds: t.fim,
            title: t.title,
            hook: t.hook,
            reason: t.reason,
            score: t.score,
            origin: t.origem,
            status: 'pendente',
          }),
        ),
      );

      // 4. Corta, um por vez, e sobe cada um assim que sai — a tela vê o
      // progresso e uma falha isolada não derruba o resto.
      let prontos = 0;
      /*
       * Seguir o rosto só faz sentido quando a fonte é mais larga que o
       * formato pedido (16:9 → 9:16 ou 1:1); numa fonte já vertical o
       * enquadramento sem crop é igual e não vale a análise.
       */
      const seguirRosto =
        job.reframe === 'rosto' &&
        job.format !== '16:9' &&
        this.faces.enabled &&
        (await this.fonteMaisLargaQue(fonte, job.format as CutFormat));
      await this.ffmpeg.comTmp('pikpok-cuts-', async (pasta) => {
        for (const clip of registros) {
          const saida = join(pasta, `${clip.position}.mp4`);
          try {
            let rosto: PontoDeRosto[] | undefined;
            if (seguirRosto) {
              try {
                rosto =
                  (await this.faces.rastrear(
                    fonte,
                    clip.startSeconds,
                    clip.endSeconds - clip.startSeconds,
                  )) ?? undefined;
              } catch (error) {
                this.logger.warn(
                  `Rastreio de rosto do corte ${clip.position} (job ${id}) falhou; usando fundo desfocado: ${error}`,
                );
              }
            }
            const opcoes: OpcoesDeCorte = { estilo: job.captionStyle, rosto };
            /*
             * Legenda queimada é tentativa, não promessa: o filtro `subtitles`
             * depende do libass e de uma fonte no servidor, e o host
             * compartilhado pode não ter nenhuma. Falhou com legenda, sai sem
             * — o corte vale mais que a legenda dele, e `clip.captions` diz o
             * que aconteceu de verdade.
             */
            let comLegenda = false;
            const srt = job.captions
              ? srtDoTrecho(fala, clip.startSeconds, clip.endSeconds, job.captionStyle)
              : '';
            if (srt) {
              const srtPath = join(pasta, `${clip.position}.srt`);
              await writeFile(srtPath, srt, 'utf8');
              try {
                await this.ffmpeg.cortar(
                  fonte,
                  saida,
                  clip.startSeconds,
                  clip.endSeconds,
                  job.format as CutFormat,
                  TIMEOUT_POR_CORTE_MS,
                  srtPath,
                  opcoes,
                );
                comLegenda = true;
              } catch (error) {
                this.logger.warn(
                  `Legenda do corte ${clip.position} (job ${id}) falhou; gerando sem legenda: ${error}`,
                );
              } finally {
                await unlink(srtPath).catch(() => undefined);
              }
            }
            if (!comLegenda) {
              await this.ffmpeg.cortar(
                fonte,
                saida,
                clip.startSeconds,
                clip.endSeconds,
                job.format as CutFormat,
                TIMEOUT_POR_CORTE_MS,
                undefined,
                opcoes,
              );
            }
            const buffer = await readFile(saida);
            const url = await this.mirror.putVideo(buffer, `${PREFIXO_S3}/${userId}`, clip.id);
            if (!url) throw new Error('Falha ao guardar o corte no armazenamento.');
            await this.clips.update(
              { id: clip.id },
              { url, status: 'pronto', error: null, captions: comLegenda },
            );
            prontos += 1;
          } catch (error) {
            const mensagem = (error as Error).message ?? String(error);
            this.logger.warn(`Corte ${clip.position} do job ${id} falhou: ${mensagem}`);
            await this.clips.update(
              { id: clip.id },
              { status: 'falhou', error: mensagem.slice(0, 500) },
            );
            await this.billing.refund(userId, acao, `Cortes: o corte ${clip.position} falhou`);
          } finally {
            // Entregue ou estornado: este corte não é mais pendência.
            await this.jobs.decrement({ id }, 'pendingCutCharges', 1);
            await unlink(saida).catch(() => undefined);
          }
        }
      });

      if (!prontos) {
        throw new Error('Nenhum corte pôde ser gerado. Os créditos foram devolvidos.');
      }
      await this.jobs.update(
        { id },
        { status: 'pronto', processingStartedAt: null, error: null, pendingCutCharges: 0 },
      );
    } catch (error) {
      const mensagem = (error as Error).message ?? String(error);
      this.logger.error(`Job de cortes ${id} falhou: ${mensagem}`);
      await this.estornarPendentes(id, 'Cortes: processamento falhou');
      await this.jobs
        .update(
          { id },
          { status: 'falhou', processingStartedAt: null, error: mensagem.slice(0, 500) },
        )
        .catch((e) => this.logger.error(`Não consegui marcar o job ${id} como falhou: ${e}`));
    } finally {
      clearInterval(batimento);
      this.emAndamento.delete(id);
      if (fonte) await unlink(fonte).catch(() => undefined);
      if (pastaDoDownload) await rm(pastaDoDownload, { recursive: true, force: true }).catch(() => undefined);
      await this.jobs.update({ id }, { sourcePath: null }).catch(() => undefined);
    }
  }

  /** A fonte é mais larga que o formato pedido? (É quando o crop/rosto tem efeito.) */
  private async fonteMaisLargaQue(fonte: string, formato: CutFormat): Promise<boolean> {
    const dim = await this.ffmpeg.dimensoes(fonte).catch(() => null);
    if (!dim || !dim.altura) return false;
    const alvo = formato === '1:1' ? 1 : 9 / 16;
    return dim.largura / dim.altura > alvo + 0.05;
  }

  /**
   * Modo inteligente: transcreve (fatiado, com offset) e pede à IA os trechos.
   * O que a IA não preencher, o modo rápido completa — evitando os trechos dela.
   */
  private async planejarInteligente(
    job: CutJob,
    fonte: string,
    duracao: number,
  ): Promise<{ trechos: TrechoPlanejado[]; fala: SegmentoDeFala[] }> {
    const segmentos: SegmentoDeFala[] = await this.chunker.comAudioExtraido(
      fonte,
      job.sourceName,
      async ({ audioPath, pasta }) => {
        const fatias = await this.chunker.fatiar(audioPath, pasta, SEGUNDOS_POR_FATIA);
        const todos: SegmentoDeFala[] = [];
        let offset = 0;
        let contexto = '';
        // Palavras com tempo só quando a legenda karaokê vai usá-las.
        const querPalavras = job.captions && job.captionStyle === 'karaoke';
        for (let i = 0; i < fatias.length; i += 1) {
          const conteudo = await readFile(fatias[i].caminho);
          const { segments, transcript, words } = await this.transcricao.transcribeBuffer(
            conteudo,
            `fatia-${String(i).padStart(3, '0')}.ogg`,
            {
              mimetype: 'audio/ogg',
              verboseTimestamps: true,
              wordTimestamps: querPalavras,
              prompt: contexto || undefined,
              durationSeconds: fatias[i].duracaoSec ?? undefined,
              userId: job.userId,
            },
          );
          for (const s of segments ?? []) {
            if (!s.text) continue;
            const seg: SegmentoDeFala = {
              inicio: offset + s.start,
              fim: offset + s.end,
              texto: s.text,
            };
            if (words?.length) {
              // As palavras do segmento são as que caem dentro do tempo dele.
              const dentro = words.filter((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05);
              if (dentro.length) {
                seg.palavras = dentro.map((w) => ({
                  inicio: offset + w.start,
                  fim: offset + w.end,
                  texto: w.word,
                }));
              }
            }
            todos.push(seg);
          }
          offset += fatias[i].duracaoSec ?? 0;
          contexto = transcript.slice(-300);
        }
        return todos;
      },
    );

    let daIa: TrechoPlanejado[] = [];
    if (segmentos.length) {
      const sugestoes = await this.ai.escolherCortes({
        segmentos,
        duracaoFonte: duracao,
        quantidade: job.quantity,
        minSeg: job.minSeconds,
        maxSeg: job.maxSeconds,
        userId: job.userId,
      });
      daIa = validarSugestoes(sugestoes, duracao, job.quantity, job.minSeconds, job.maxSeconds);
      this.logger.log(
        `Job ${job.id}: IA sugeriu ${sugestoes.length} trecho(s), ${daIa.length} válido(s) ${JSON.stringify(sugestoes.map((s) => [s.inicio, s.fim]))}`,
      );
    } else {
      this.logger.warn(`Job ${job.id}: transcrição vazia, caindo para o modo rápido.`);
    }

    const faltam = job.quantity - daIa.length;
    if (faltam <= 0) return { trechos: daIa, fala: segmentos };
    const silencios = await this.ffmpeg.silencios(fonte);
    const complemento = planejarRapido(
      duracao,
      faltam,
      job.minSeconds,
      job.maxSeconds,
      silencios,
      daIa,
    );
    return { trechos: [...daIa, ...complemento], fala: segmentos };
  }

  // ------------------------------------------------------ → Multiplicador

  /**
   * Um corte pronto vira clipe (gancho, corpo ou CTA) do Multiplicador.
   *
   * O teto de duração é o do bloco (`clip-timing.ts`): um corte de 45 s não
   * cabe em corpo (25 s) e a montagem recusaria depois — melhor recusar aqui,
   * com a conta na mensagem. A tela já esconde os blocos em que não cabe.
   * Não cobra nada: clipe é de graça, quem custa é a montagem.
   */
  async enviarParaMultiplicador(
    userId: string,
    clipId: string,
    role: ClipRole,
    produto?: string,
  ) {
    const clip = await this.clips.findOneBy({ id: clipId, userId });
    if (!clip) throw new NotFoundException('Corte não encontrado.');
    if (clip.status !== 'pronto' || !clip.url) {
      throw new BadRequestException('Este corte ainda não está pronto.');
    }
    const duracao = clip.endSeconds - clip.startSeconds;
    const faixa = FAIXAS[role];
    if (duracao > faixa.limite) {
      throw new BadRequestException(
        `Este corte tem ${Math.round(duracao)} s e o bloco aceita até ${faixa.limite} s. Gere cortes mais curtos (faixa de ${LIMITES.corteMinSeg}–${faixa.limite} s) para usar como ${nomeDoBloco(role)}.`,
      );
    }
    const prefixo = `${MEDIA_ROUTE}/`;
    if (!clip.url.startsWith(prefixo)) {
      throw new BadRequestException('Este corte não está no nosso armazenamento.');
    }
    const objeto = await this.mirror.readObject(clip.url.slice(prefixo.length));
    if (!objeto) throw new BadRequestException('Não consegui ler o arquivo do corte.');
    const job = await this.jobs.findOneBy({ id: clip.jobId });
    const nome = `${(job?.sourceName ?? 'video').replace(/\.[^.]+$/, '')}-corte-${clip.position}.mp4`;
    return this.combinations.uploadClip(userId, role, nome, objeto.body, produto);
  }

  // -------------------------------------------------------------------- cron

  /** Devolve o que foi cobrado e ainda não virou entrega, pelos marcadores do job. */
  private async estornarPendentes(id: string, motivo: string): Promise<void> {
    const job = await this.jobs.findOneBy({ id });
    if (!job) return;
    const acao: BillableAction = job.mode === 'inteligente' ? 'cut_ai' : 'cut';
    try {
      if (job.pendingCutCharges > 0) {
        await this.billing.refund(job.userId, acao, motivo, job.pendingCutCharges);
      }
      if (job.pendingTranscribeBlocks > 0) {
        await this.billing.refund(job.userId, 'transcribe', motivo, job.pendingTranscribeBlocks);
      }
    } finally {
      await this.jobs.update({ id }, { pendingCutCharges: 0, pendingTranscribeBlocks: 0 });
    }
  }

  /**
   * Job que parou de bater há mais de 15 min morreu com o processo (deploy,
   * restart, OOM). Estorna o que ficou pendente e marca como falhou com uma
   * mensagem que diz a verdade — e que os créditos voltaram.
   */
  @Cron('*/2 * * * *')
  async reabrirJobsTravados(): Promise<number> {
    const limite = new Date(Date.now() - MINUTOS_ATE_CONSIDERAR_TRAVADO * 60_000);
    const candidatos = await this.jobs.find({
      where: { status: 'processando', processingStartedAt: LessThan(limite) },
    });
    const travados = candidatos.filter((j) => !this.emAndamento.has(j.id));
    for (const job of travados) {
      await this.estornarPendentes(job.id, 'Cortes: processamento interrompido no servidor');
      if (job.sourcePath) await unlink(job.sourcePath).catch(() => undefined);
      await this.jobs.update(
        { id: job.id },
        {
          status: 'falhou',
          processingStartedAt: null,
          sourcePath: null,
          error:
            'O processamento foi interrompido antes de terminar (provavelmente uma reinicialização do servidor). Os créditos foram devolvidos; envie o vídeo novamente.',
        },
      );
      this.logger.warn(`Job de cortes ${job.id} reaberto pelo cron como falhou.`);
    }
    return travados.length;
  }

  // ---------------------------------------------------------------- helpers

  private async achar(userId: string, id: string): Promise<CutJob> {
    const job = await this.jobs.findOneBy({ id, userId });
    if (!job) throw new NotFoundException('Job de cortes não encontrado.');
    return job;
  }

  /** O que a tela vê — nunca o caminho em disco nem os marcadores de cobrança. */
  private publico(job: CutJob) {
    const { sourcePath: _p, pendingCutCharges: _c, pendingTranscribeBlocks: _t, ...resto } = job;
    return resto;
  }
}

function nomeDoBloco(role: ClipRole): string {
  return role === 'hook' ? 'gancho' : role === 'body' ? 'corpo' : 'CTA';
}

function formatarDuracao(seg: number): string {
  const m = Math.floor(seg / 60);
  const s = Math.round(seg % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
}
