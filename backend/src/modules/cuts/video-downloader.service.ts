import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { access, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * O YouTube exige que o yt-dlp resolva um desafio em JavaScript; sem runtime
 * ele não lista os formatos e o download falha. O próprio Node que roda o
 * backend serve — apontado explicitamente, porque no host o PATH do processo
 * filho não necessariamente inclui a pasta do node.
 */
const JS_RUNTIME = ['--js-runtimes', `node:${dirname(process.execPath)}`];
import { FfmpegRunner } from '../../common/media/ffmpeg-runner';

export interface InfoDoLink {
  titulo: string;
  duracaoSeg: number | null;
  thumb: string | null;
  plataforma: string;
}

/**
 * Baixa a fonte dos Cortes a partir de um link (YouTube primeiro; o yt-dlp
 * cobre Twitch/Kick/Drive de brinde) e entrega um MP4 local, o mesmo que o
 * upload entregaria.
 *
 * O binário do yt-dlp NÃO vai no repo: é baixado do GitHub no primeiro uso
 * para `YT_DLP_DIR` (padrão: pasta temporária do sistema) e reaproveitado. Em
 * produção `YT_DLP_PATH` aponta um binário já instalado e pula o download.
 * Sem binário e sem rede, `enabled` é falso e a tela esconde a aba de link —
 * o upload continua funcionando.
 */
@Injectable()
export class VideoDownloaderService {
  private readonly logger = new Logger(VideoDownloaderService.name);
  private binario: Promise<string | null> | null = null;

  constructor(private readonly ffmpeg: FfmpegRunner) {}

  get enabled(): boolean {
    return process.env.CUTS_URL_IMPORT !== '0';
  }

  /** Título, duração e capa — o que a tela mostra antes de confirmar. */
  async inspecionar(url: string): Promise<InfoDoLink> {
    const cli = await this.cli();
    let info: any;
    try {
      /*
       * Não usa `getVideoInfo` do wrapper: ele acrescenta `-f best`, e o
       * YouTube de hoje não tem um "best" único (áudio e vídeo separados) —
       * falha com "Requested format is not available" mesmo para vídeo
       * público. Só os metadados, sem escolher formato.
       */
      const json = await cli.execPromise([
        ...JS_RUNTIME,
        '--no-playlist',
        '--no-warnings',
        '--skip-download',
        '--dump-single-json',
        url,
      ]);
      info = JSON.parse(json);
    } catch (error) {
      // A frase para o usuário é genérica de propósito; a causa real vai para o log.
      // ERROR de propósito: o painel da Hostinger só mostra stderr.
      this.logger.error(`yt-dlp falhou em ${url}: ${String((error as Error)?.message ?? error).slice(0, 600)}`);
      throw new BadRequestException(traduzirErro(error));
    }
    if (info?.is_live) {
      throw new BadRequestException(
        'Esse link é uma live em andamento. Espere terminar (ou use a gravação) para cortar.',
      );
    }
    return {
      titulo: String(info?.title ?? 'Vídeo').slice(0, 255),
      duracaoSeg: Number.isFinite(Number(info?.duration)) ? Number(info.duration) : null,
      thumb: typeof info?.thumbnail === 'string' ? info.thumbnail : null,
      plataforma: String(info?.extractor_key ?? 'link'),
    };
  }

  /**
   * Baixa para `pasta` e devolve o caminho do MP4. Vídeo até 1080p (cortes
   * saem em 720p — mais que isso é download à toa) e mesclado com áudio pelo
   * nosso ffmpeg, já que o host não tem outro.
   */
  async baixar(url: string, pasta: string, maxBytes: number): Promise<string> {
    const cli = await this.cli();
    await mkdir(pasta, { recursive: true });
    const ffmpegDir = this.ffmpeg.binario ? dirname(this.ffmpeg.binario) : null;
    const args = [
      ...JS_RUNTIME,
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '-f',
      'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*[height<=1080]+ba/b',
      '--merge-output-format',
      'mp4',
      '--max-filesize',
      String(maxBytes),
      '-o',
      join(pasta, 'fonte.%(ext)s'),
      ...(ffmpegDir ? ['--ffmpeg-location', ffmpegDir] : []),
      url,
    ];
    try {
      await cli.execPromise(args);
    } catch (error) {
      // A frase para o usuário é genérica de propósito; a causa real vai para o log.
      // ERROR de propósito: o painel da Hostinger só mostra stderr.
      this.logger.error(`yt-dlp falhou em ${url}: ${String((error as Error)?.message ?? error).slice(0, 600)}`);
      throw new BadRequestException(traduzirErro(error));
    }
    const arquivos = (await readdir(pasta)).filter((n) => n.startsWith('fonte.'));
    const mp4 = arquivos.find((n) => n.endsWith('.mp4')) ?? arquivos[0];
    if (!mp4) {
      throw new BadRequestException('Não consegui baixar o vídeo desse link.');
    }
    return join(pasta, mp4);
  }

  private async cli() {
    const caminho = await this.localizarBinario();
    if (!caminho) {
      throw new BadRequestException(
        'Importar por link está indisponível neste servidor no momento. Envie o arquivo do vídeo.',
      );
    }
    const { default: YTDlpWrap } = await import('yt-dlp-wrap');
    return new YTDlpWrap(caminho);
  }

  private localizarBinario(): Promise<string | null> {
    if (!this.binario) {
      this.binario = (async () => {
        const fixo = process.env.YT_DLP_PATH;
        if (fixo) return fixo;
        const pasta = process.env.YT_DLP_DIR || join(tmpdir(), 'pikpok-bin');
        const nome = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
        const caminho = join(pasta, nome);
        try {
          await access(caminho);
          return caminho;
        } catch {
          /* ainda não baixado */
        }
        try {
          await mkdir(pasta, { recursive: true });
          const { default: YTDlpWrap } = await import('yt-dlp-wrap');
          await YTDlpWrap.downloadFromGithub(caminho);
          this.logger.log(`yt-dlp baixado em ${caminho}`);
          return caminho;
        } catch (error) {
          this.logger.error(`yt-dlp indisponível (${error}); import por link desligado.`);
          // Deixa tentar de novo na próxima chamada em vez de fixar o "não".
          this.binario = null;
          return null;
        }
      })();
    }
    return this.binario;
  }
}

/** As mensagens do yt-dlp são para dev; o usuário vê uma frase em português. */
function traduzirErro(error: unknown): string {
  const texto = String((error as Error)?.message ?? error);
  if (/confirm you.re not a bot|sign in to confirm/i.test(texto)) {
    return 'O YouTube bloqueou o download a partir do nosso servidor. Baixe o vídeo e envie o arquivo.';
  }
  if (/javascript runtime|js runtime/i.test(texto)) {
    return 'O servidor não conseguiu preparar o download do YouTube agora. Envie o arquivo do vídeo.';
  }
  if (/private video|login required|sign in/i.test(texto)) {
    return 'Esse vídeo é privado ou exige login. Use um vídeo público ou envie o arquivo.';
  }
  if (/unavailable|removed|does not exist|404/i.test(texto)) {
    return 'Vídeo indisponível nesse link. Confira se ele ainda está no ar.';
  }
  if (/unsupported url|no video formats/i.test(texto)) {
    return 'Não reconheci esse link. Cole o link de um vídeo do YouTube.';
  }
  if (/file is larger than max-filesize/i.test(texto)) {
    return 'O vídeo passa do tamanho máximo (2 GB). Envie um arquivo menor.';
  }
  return 'Não consegui baixar o vídeo desse link. Tente outro ou envie o arquivo.';
}
