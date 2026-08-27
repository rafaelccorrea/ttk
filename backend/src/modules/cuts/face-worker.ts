/**
 * Worker do rastreio de rosto — roda o BlazeFace FORA do event loop.
 *
 * O tfjs em CPU pura é JavaScript síncrono: cada inferência trava a thread
 * onde roda. No processo principal isso segurava o batimento do job, as
 * requisições HTTP e o cron — e num host compartilhado com limite de CPU o
 * processo inteiro era derrubado no meio de um job, que o cron depois marcava
 * como "interrompido no servidor". Aqui, se demorar demais, o serviço mata só
 * este worker e o corte sai com fundo desfocado.
 *
 * Protocolo: recebe `{ id, quadros: string[] }` e responde
 * `{ id, centros: Array<number | null> }` (centro horizontal 0–1 do maior
 * rosto de cada quadro) ou `{ id, erro: string }`.
 */
import { readFile } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';

interface BlazeFaceModel {
  estimateFaces(
    entrada: unknown,
    returnTensors: boolean,
  ): Promise<Array<{ topLeft: unknown; bottomRight: unknown }>>;
}

let modelo: Promise<BlazeFaceModel> | null = null;

function carregar(): Promise<BlazeFaceModel> {
  if (!modelo) {
    modelo = (async () => {
      await import('@tensorflow/tfjs');
      const blazeface = await import('@tensorflow-models/blazeface');
      const modelUrl = process.env.CUTS_FACE_MODEL_URL || undefined;
      const m = await blazeface.load({ maxFaces: 3, scoreThreshold: 0.7, modelUrl });
      return m as unknown as BlazeFaceModel;
    })();
    modelo.catch(() => {
      modelo = null;
    });
  }
  return modelo;
}

async function centroDoRosto(m: BlazeFaceModel, caminho: string): Promise<number | null> {
  const { decode } = await import('jpeg-js');
  const tf = await import('@tensorflow/tfjs');
  const jpeg = decode(await readFile(caminho), { useTArray: true, formatAsRGBA: false });
  const entrada = tf.tensor3d(jpeg.data, [jpeg.height, jpeg.width, 3], 'int32');
  try {
    const rostos = await m.estimateFaces(entrada as never, false);
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

parentPort?.on('message', async (msg: { id: number; quadros: string[] }) => {
  try {
    const m = await carregar();
    const centros: Array<number | null> = [];
    for (const caminho of msg.quadros) {
      centros.push(await centroDoRosto(m, caminho));
    }
    parentPort?.postMessage({ id: msg.id, centros });
  } catch (error) {
    parentPort?.postMessage({ id: msg.id, erro: String((error as Error)?.message ?? error) });
  }
});
