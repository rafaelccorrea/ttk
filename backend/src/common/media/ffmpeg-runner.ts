import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

/** Teto padrão de uma chamada de ffmpeg. Fatiar 4h de áudio leva ~1 min. */
const TIMEOUT_PADRAO_MS = 10 * 60_000;

/**
 * O acesso ao binário do ffmpeg, num lugar só.
 *
 * Antes disso o `spawn` do ffmpeg vivia dentro do `VideoAssemblyService`, junto
 * com a montagem de vídeo do Multiplicador — e o pipeline da live precisa
 * exatamente das mesmas três coisas (rodar, ler duração, escrever um buffer num
 * tmp) sem precisar de nada de montagem. Copiar seria a terceira versão do
 * mesmo `execFile` no repo.
 *
 * Uma peculiaridade herdada e mantida: `ffmpeg-static` NÃO traz o ffprobe, por
 * isso a duração é lida do relatório que o próprio ffmpeg escreve no stderr.
 */
@Injectable()
export class FfmpegRunner {
  private readonly logger = new Logger(FfmpegRunner.name);

  get enabled(): boolean {
    return Boolean(ffmpegPath);
  }

  get binario(): string | null {
    return (ffmpegPath as string | null) ?? null;
  }

  async rodar(args: string[], timeoutMs = TIMEOUT_PADRAO_MS): Promise<void> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    try {
      await execFileAsync(ffmpegPath as string, args, {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (error) {
      // O ffmpeg escreve o motivo real no stderr; sem isso o erro vira só
      // "Command failed" e não dá para saber o que quebrou.
      const stderr = (error as { stderr?: string }).stderr ?? '';
      const ultima = stderr.trim().split('\n').slice(-3).join(' ');
      throw new Error(`ffmpeg falhou: ${ultima || (error as Error).message}`);
    }
  }

  /**
   * O relatório que o `ffmpeg -i` escreve no stderr sobre o arquivo.
   *
   * Sem arquivo de saída o comando sempre termina em erro — é o modo dele de
   * só descrever a entrada — então o `catch` é o caminho normal, não a exceção.
   */
  async inspecionar(arquivo: string): Promise<string> {
    if (!ffmpegPath) return '';
    try {
      const { stderr } = await execFileAsync(ffmpegPath as string, [
        '-i', arquivo, '-hide_banner',
      ]);
      return stderr ?? '';
    } catch (error) {
      return (error as { stderr?: string }).stderr ?? '';
    }
  }

  /**
   * O que o ffmpeg enxerga de streams no arquivo.
   *
   * Existe para PERGUNTAR antes de mandar trabalho: extrair voz de uma gravação
   * sem trilha de áudio termina em "Output file does not contain any stream",
   * que é verdade e não ajuda ninguém — o vendedor lê isso no lugar de "a sua
   * gravação está sem som".
   *
   * `legivel` separa os dois fracassos que pareciam um só: um arquivo mudo tem
   * stream de vídeo e nenhuma de áudio; um arquivo corrompido ou que não é mídia
   * não tem stream nenhuma. As correções são diferentes (gravar de novo com o
   * microfone ligado vs. enviar outro arquivo), então a mensagem também é.
   */
  async streamsDe(arquivo: string): Promise<{ legivel: boolean; audio: boolean }> {
    const saida = await this.inspecionar(arquivo);
    return {
      legivel: /Stream #\d+:\d+/.test(saida),
      audio: /Stream #\d+:\d+.*:\s*Audio:/i.test(saida),
    };
  }

  /** Duração do arquivo em segundos, ou `null` quando não der para ler. */
  async duracao(arquivo: string): Promise<number | null> {
    const saida = await this.inspecionar(arquivo);
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(saida);
    if (!m) return null;
    const total = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  /**
   * Duração de um arquivo que ainda está em memória, em segundos.
   *
   * O ffmpeg só lê de disco, então o buffer passa por um tmp descartável. É o
   * que permite cobrar a transcrição pelo tempo real do áudio em vez de chutar
   * pelo tamanho do arquivo. Devolve `null` quando não há ffmpeg no ambiente ou
   * quando o arquivo não é mídia legível — quem chama decide o que fazer.
   */
  async duracaoDoBuffer(buffer: Buffer, nome = 'entrada.mp4'): Promise<number | null> {
    if (!ffmpegPath) return null;
    return this.comTmp('pikpok-duracao-', async (pasta) => {
      const arquivo = join(pasta, `entrada.${this.extensaoDe(nome)}`);
      try {
        await writeFile(arquivo, buffer);
        return await this.duracao(arquivo);
      } catch (error) {
        this.logger.warn(`Não foi possível ler a duração do arquivo: ${error}`);
        return null;
      }
    });
  }

  /** Só a extensão do nome interessa — o resto viraria caminho. */
  extensaoDe(nome: string, padrao = 'mp4'): string {
    return (/\.([A-Za-z0-9]{1,5})$/.exec(nome)?.[1] ?? padrao).toLowerCase();
  }

  /** Roda `fn` numa pasta temporária e apaga tudo depois, inclusive em erro. */
  async comTmp<T>(prefixo: string, fn: (pasta: string) => Promise<T>): Promise<T> {
    const pasta = await mkdtemp(join(tmpdir(), prefixo));
    try {
      return await fn(pasta);
    } finally {
      await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
