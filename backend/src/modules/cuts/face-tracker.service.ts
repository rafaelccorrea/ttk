import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { FfmpegRunner, PontoDeRosto } from '../../common/media/ffmpeg-runner';

/**
 * Onde está o rosto de quem fala, segundo a segundo, para o corte 9:16 seguir.
 *
 * Amostra 1 quadro por segundo em 320 px (ffmpeg), roda o BlazeFace (modelo
 * de ~400 KB, tfjs puro em CPU — sem binário nativo, cabe no host
 * compartilhado) e devolve a trilha do centro horizontal do MAIOR rosto de
 * cada quadro, suavizada. Os quadros sem rosto herdam o vizinho mais próximo;
 * se a maioria não tem rosto, não há o que seguir e o chamador cai para o
 * fundo desfocado.
 *
 * O modelo é baixado do TF Hub no primeiro uso e fica em memória. Sem rede
 * (ou com `CUTS_FACE_TRACKING=0`) o serviço só devolve `null` — o corte sai
 * com o enquadramento antigo, nunca falha por causa disto.
 */
@Injectable()
export class FaceTrackerService {
  private readonly logger = new Logger(FaceTrackerService.name);
  private modelo: Promise<BlazeFaceModel | null> | null = null;

  constructor(private readonly ffmpeg: FfmpegRunner) {}

  get enabled(): boolean {
    return process.env.CUTS_FACE_TRACKING !== '0';
  }

  /**
   * Trilha do rosto em `[inicioSeg, inicioSeg + duracaoSeg]` da fonte, com `t`
   * relativo ao início do trecho. `null` = sem rosto suficiente / sem modelo.
   */
  async rastrear(
    fonte: string,
    inicioSeg: number,
    duracaoSeg: number,
  ): Promise<PontoDeRosto[] | null> {
    if (!this.enabled) return null;
    const modelo = await this.carregar();
    if (!modelo) return null;

    return this.ffmpeg.comTmp('pikpok-faces-', async (pasta) => {
      const quadros = await this.ffmpeg.amostrarQuadros(fonte, pasta, inicioSeg, duracaoSeg, {
        fps: FPS_DE_AMOSTRA,
        largura: LARGURA_DE_AMOSTRA,
      });
      if (!quadros.length) return null;

      const centros: Array<number | null> = [];
      for (const caminho of quadros) {
        centros.push(await this.centroDoRosto(modelo, caminho));
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

  /** Centro horizontal (0–1) do maior rosto do quadro, ou null. */
  private async centroDoRosto(modelo: BlazeFaceModel, caminho: string): Promise<number | null> {
    const { decode } = await import('jpeg-js');
    const tf = await import('@tensorflow/tfjs');
    const jpeg = decode(await readFile(caminho), { useTArray: true, formatAsRGBA: false });
    const entrada = tf.tensor3d(jpeg.data, [jpeg.height, jpeg.width, 3], 'int32');
    try {
      const rostos = await modelo.estimateFaces(entrada as never, false);
      if (!rostos.length) return null;
      let melhor = rostos[0];
      let area = 0;
      for (const r of rostos) {
        const [x1, y1] = r.topLeft as [number, number];
        const [x2, y2] = r.bottomRight as [number, number];
        const a = Math.abs((x2 - x1) * (y2 - y1));
        if (a > area) {
          area = a;
          melhor = r;
        }
      }
      const [x1] = melhor.topLeft as [number, number];
      const [x2] = melhor.bottomRight as [number, number];
      return Math.max(0, Math.min(1, (x1 + x2) / 2 / jpeg.width));
    } finally {
      entrada.dispose();
    }
  }

  private carregar(): Promise<BlazeFaceModel | null> {
    if (!this.modelo) {
      this.modelo = (async () => {
        try {
          await import('@tensorflow/tfjs');
          const blazeface = await import('@tensorflow-models/blazeface');
          const modelUrl = process.env.CUTS_FACE_MODEL_URL || undefined;
          const modelo = await blazeface.load({ maxFaces: 3, scoreThreshold: 0.7, modelUrl });
          this.logger.log('BlazeFace carregado (rastreio de rosto nos cortes ativo).');
          return modelo as unknown as BlazeFaceModel;
        } catch (error) {
          this.logger.warn(
            `BlazeFace não carregou (${error}); cortes saem com fundo desfocado em vez de seguir o rosto.`,
          );
          return null;
        }
      })();
    }
    return this.modelo;
  }
}

/** Uma amostra por segundo basta: a cabeça não atravessa o quadro em menos. */
const FPS_DE_AMOSTRA = 1;
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

interface BlazeFaceModel {
  estimateFaces(
    entrada: unknown,
    returnTensors: boolean,
  ): Promise<Array<{ topLeft: unknown; bottomRight: unknown; probability?: unknown }>>;
}
