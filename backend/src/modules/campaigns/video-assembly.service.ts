import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

/** Formato final: 9:16 em 1080p, que é o que o TikTok entrega sem recomprimir. */
const LARGURA = 1080;
const ALTURA = 1920;

/** Teto de tempo da montagem — 6 cenas levam ~40s; acima disso algo travou. */
const TIMEOUT_MS = 5 * 60_000;

/**
 * Junta as cenas de uma campanha num único MP4.
 *
 * Por que re-codificar em vez de concatenar os arquivos crus: as cenas voltam
 * da fornecedora com resolução, taxa de quadros e parâmetros de codec que
 * variam entre gerações. O `concat` do ffmpeg no modo rápido (sem recodificar)
 * exige que TUDO bata, e quando não bate ele não falha — entrega um arquivo
 * que congela na virada da cena. Normalizar cada trecho antes de juntar custa
 * alguns segundos de CPU e é a diferença entre um vídeo publicável e um
 * defeito que só aparece depois de postado.
 *
 * A conta é de CPU, não de IA: a montagem não consome créditos.
 */
@Injectable()
export class VideoAssemblyService {
  private readonly logger = new Logger(VideoAssemblyService.name);

  get enabled(): boolean {
    return Boolean(ffmpegPath);
  }

  /**
   * Recebe os MP4 das cenas na ordem do roteiro e devolve o vídeo final.
   * Trabalha em memória/tmp e limpa tudo ao terminar, inclusive em erro.
   */
  async juntar(cenas: Buffer[]): Promise<Buffer> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    if (!cenas.length) {
      throw new Error('Nenhuma cena pronta para montar.');
    }

    const pasta = await mkdtemp(join(tmpdir(), 'pikpok-montagem-'));
    try {
      // 1) Normaliza cada cena para o mesmo formato.
      const normalizadas: string[] = [];
      for (const [i, cena] of cenas.entries()) {
        const entrada = join(pasta, `cena-${i}.mp4`);
        const saida = join(pasta, `norm-${i}.mp4`);
        await writeFile(entrada, cena);
        await this.rodar([
          '-y',
          '-i', entrada,
          // `setsar=1` evita a imagem esticada quando a cena vem com pixel
          // não-quadrado; sem isso a virada de cena "pula" de largura.
          '-vf', `scale=${LARGURA}:${ALTURA}:force_original_aspect_ratio=decrease,pad=${LARGURA}:${ALTURA}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          // Trilha de silêncio quando a cena vier muda: o concat descarta o
          // áudio inteiro se um dos trechos não tiver faixa.
          '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-shortest',
          '-c:a', 'aac',
          '-ar', '44100',
          '-map', '0:v:0',
          '-map', '1:a:0',
          saida,
        ]);
        normalizadas.push(saida);
      }

      // 2) Junta. Já que todos os trechos são idênticos em formato, aqui o
      //    modo rápido é seguro e não perde qualidade de novo.
      const lista = join(pasta, 'lista.txt');
      await writeFile(
        lista,
        normalizadas.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
      );
      const final = join(pasta, 'final.mp4');
      await this.rodar([
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', lista,
        '-c', 'copy',
        // `+faststart` põe o índice no começo: o vídeo começa a tocar antes de
        // baixar inteiro, que é como o navegador espera.
        '-movflags', '+faststart',
        final,
      ]);

      return await readFile(final);
    } finally {
      await rm(pasta, { recursive: true, force: true }).catch((error) =>
        this.logger.warn(`Não foi possível limpar ${pasta}: ${error}`),
      );
    }
  }

  private async rodar(args: string[]): Promise<void> {
    try {
      await execFileAsync(ffmpegPath as string, args, {
        timeout: TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (error) {
      // O ffmpeg escreve o motivo real no stderr; sem isso o erro vira só
      // "Command failed" e não dá para saber qual cena quebrou.
      const stderr = (error as { stderr?: string }).stderr ?? '';
      const ultima = stderr.trim().split('\n').slice(-3).join(' ');
      throw new Error(`ffmpeg falhou: ${ultima || (error as Error).message}`);
    }
  }
}
