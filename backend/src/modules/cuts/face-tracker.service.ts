import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { FfmpegRunner, PontoDeRosto } from '../../common/media/ffmpeg-runner';

/**
 * Onde está o rosto de quem fala, para o corte 9:16 seguir.
 *
 * Amostra quadros em 320 px (ffmpeg) e roda o BlazeFace (tfjs puro em CPU,
 * sem binário nativo) num WORKER THREAD — ver `face-worker.ts` para o porquê:
 * a inferência é síncrona e no processo principal travava o batimento do job
 * e derrubava o processo no host compartilhado. Cada corte tem um teto de
 * tempo; estourou, o worker é morto e o chamador recebe `RastreioDemorouError`
 * para desistir do rastreio no resto do job.
 *
 * Sem modelo, sem rede ou com `CUTS_FACE_TRACKING=0` devolve `null` — o corte
 * sai com o fundo desfocado, nunca falha por causa disto.
 */
@Injectable()
export class FaceTrackerService implements OnModuleDestroy {
  private readonly logger = new Logger(FaceTrackerService.name);
  private worker: Worker | null = null;
  private proximoId = 1;
  private readonly pendentes = new Map<
    number,
    { resolve: (v: Array<number | null>) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly ffmpeg: FfmpegRunner) {}

  get enabled(): boolean {
    return process.env.CUTS_FACE_TRACKING !== '0';
  }

  onModuleDestroy() {
    void this.derrubarWorker(new Error('encerrando'));
  }

  /**
   * Trilha do rosto em `[inicioSeg, inicioSeg + duracaoSeg]` da fonte, com `t`
   * relativo ao início do trecho. `null` = sem rosto suficiente / sem modelo.
   * Lança `RastreioDemorouError` se passar de `TEMPO_MAXIMO_MS`.
   */
  async rastrear(
    fonte: string,
    inicioSeg: number,
    duracaoSeg: number,
  ): Promise<PontoDeRosto[] | null> {
    if (!this.enabled) return null;

    return this.ffmpeg.comTmp('pikpok-faces-', async (pasta) => {
      const quadros = await this.ffmpeg.amostrarQuadros(fonte, pasta, inicioSeg, duracaoSeg, {
        fps: FPS_DE_AMOSTRA,
        largura: LARGURA_DE_AMOSTRA,
      });
      if (!quadros.length) return null;

      let centros: Array<number | null>;
      try {
        centros = await this.noWorker(quadros, TEMPO_MAXIMO_MS);
      } catch (error) {
        if (error instanceof RastreioDemorouError) throw error;
        this.logger.warn(
          `BlazeFace não rodou (${(error as Error).message}); corte sai com fundo desfocado.`,
        );
        return null;
      }
      const comRosto = centros.filter((c): c is number => c !== null).length;
      if (comRosto < Math.ceil(centros.length * MINIMO_COM_ROSTO)) {
        this.logger.log(
          `Rosto em ${comRosto}/${centros.length} quadros — abaixo do mínimo, sem rastreio.`,
        );
        return null;
      }
      return suavizar(preencher(centros)).map((cx, i) => ({ t: i / FPS_DE_AMOSTRA, cx }));
    });
  }

  private noWorker(quadros: string[], limiteMs: number): Promise<Array<number | null>> {
    const worker = this.obterWorker();
    const id = this.proximoId++;
    return new Promise<Array<number | null>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        this.logger.warn(
          `Rastreio de rosto passou de ${limiteMs / 1000}s em ${quadros.length} quadros; matando o worker.`,
        );
        void this.derrubarWorker(new RastreioDemorouError());
        reject(new RastreioDemorouError());
      }, limiteMs);
      this.pendentes.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      worker.postMessage({ id, quadros });
    });
  }

  private obterWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(join(__dirname, 'face-worker.js'), {
      env: process.env,
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    worker.on('message', (msg: { id: number; centros?: Array<number | null>; erro?: string }) => {
      const p = this.pendentes.get(msg.id);
      if (!p) return;
      this.pendentes.delete(msg.id);
      if (msg.centros) p.resolve(msg.centros);
      else p.reject(new Error(msg.erro ?? 'worker sem resposta'));
    });
    worker.on('error', (e) => void this.derrubarWorker(e));
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = null;
      this.rejeitarPendentes(new Error(`worker de rosto saiu (código ${code})`));
    });
    this.worker = worker;
    return worker;
  }

  private async derrubarWorker(motivo: Error): Promise<void> {
    const w = this.worker;
    this.worker = null;
    this.rejeitarPendentes(motivo);
    if (w) await w.terminate().catch(() => undefined);
  }

  private rejeitarPendentes(motivo: Error): void {
    for (const [id, p] of this.pendentes) {
      this.pendentes.delete(id);
      p.reject(motivo);
    }
  }
}

/** O rastreio de um corte passou do teto — o chamador desiste no resto do job. */
export class RastreioDemorouError extends Error {
  constructor() {
    super('Rastreio de rosto demorou demais');
    this.name = 'RastreioDemorouError';
  }
}

/**
 * Teto por corte. Num host compartilhado, um corte de 90 s a 0,5 fps são 45
 * inferências; passou disto, o rastreio está custando mais que o corte.
 */
const TEMPO_MAXIMO_MS = 45_000;
/** Uma amostra a cada 2 s basta: a cabeça não atravessa o quadro em menos. */
const FPS_DE_AMOSTRA = 0.5;
const LARGURA_DE_AMOSTRA = 320;
/** Fração mínima de quadros com rosto para valer a pena seguir. */
const MINIMO_COM_ROSTO = 0.5;

/** Quadros sem rosto herdam o vizinho mais próximo (antes ou depois). */
export function preencher(centros: Array<number | null>): number[] {
  const saida = centros.map((c) => c ?? NaN);
  let ultimo = NaN;
  for (let i = 0; i < saida.length; i += 1) {
    if (!Number.isNaN(saida[i])) ultimo = saida[i];
    else if (!Number.isNaN(ultimo)) saida[i] = ultimo;
  }
  ultimo = NaN;
  for (let i = saida.length - 1; i >= 0; i -= 1) {
    if (!Number.isNaN(saida[i])) ultimo = saida[i];
    else if (!Number.isNaN(ultimo)) saida[i] = ultimo;
  }
  return saida.map((v) => (Number.isNaN(v) ? 0.5 : v));
}

/**
 * Média móvel de 5 amostras + zona morta: o crop só se move quando o rosto
 * saiu de verdade do lugar. Sem isso cada respiração do detector vira um
 * balanço na imagem — pior que não seguir.
 */
export function suavizar(centros: number[], janela = 5, zonaMorta = 0.04): number[] {
  const meia = Math.floor(janela / 2);
  const media = centros.map((_, i) => {
    const ini = Math.max(0, i - meia);
    const fim = Math.min(centros.length, i + meia + 1);
    const fatia = centros.slice(ini, fim);
    return fatia.reduce((s, v) => s + v, 0) / fatia.length;
  });
  const saida: number[] = [];
  let atual = media[0] ?? 0.5;
  for (const v of media) {
    if (Math.abs(v - atual) > zonaMorta) atual = v;
    saida.push(atual);
  }
  return saida;
}

