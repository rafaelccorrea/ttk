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
 * Alvo de volume, em LUFS.
 *
 * As peças chegam gravadas em sessões diferentes — o gancho perto do microfone,
 * o corpo a dois metros — e o concat empilha isso sem tocar no áudio, então o
 * vídeo montado sobe e desce de volume na virada. É o defeito que mais denuncia
 * que o vídeo foi colado, e some normalizando cada peça para o mesmo padrão.
 *
 * -14 LUFS é o alvo que TikTok, YouTube e Spotify usam: entregar nesse nível
 * significa que a plataforma não vai reprocessar o áudio na ingestão.
 */
const LOUDNESS_ALVO = '-14';

/**
 * Rampa de áudio nas pontas de cada peça, em segundos.
 *
 * Cortar uma faixa no meio de uma onda gera um degrau instantâneo, e o alto-
 * falante reproduz isso como um "clique" audível a cada emenda. 30ms é curto
 * demais para o ouvido perceber como fade e longo o bastante para matar o
 * estalo.
 */
const RAMPA_SEGUNDOS = 0.03;

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
   * Encaixa a cena no quadro sem tarja preta e sem cortar nada.
   *
   * O `pad` antigo centralizava a imagem entre duas barras pretas sempre que a
   * proporção não batia — e basta o vendedor gravar um gancho na horizontal, ou
   * o celular entregar 4:5, para o vídeo sair com moldura. No feed isso lê como
   * conteúdo reaproveitado de outra plataforma, que é exatamente o oposto do
   * que se quer num criativo nativo.
   *
   * A saída passa a ter o mesmo quadro preenchido por uma cópia ampliada e
   * borrada do próprio frame, com a imagem real por cima em tamanho integral.
   * Nada é cortado (diferente de encher com `crop`) e nada fica preto.
   *
   * O borrão é feito em miniatura e só depois ampliado: `gblur` em 1080p custa
   * caro, e o resultado visual é o mesmo — é fundo desfocado, não detalhe.
   */
  private filtroDeVideo(largura: number, altura: number): string {
    const fundoL = Math.max(Math.round(largura / 8), 2);
    const fundoA = Math.max(Math.round(altura / 8), 2);
    return [
      '[0:v]split=2[bruto][frente]',
      `[bruto]scale=${largura}:${altura}:force_original_aspect_ratio=increase,` +
        `crop=${largura}:${altura},scale=${fundoL}:${fundoA},gblur=sigma=6,` +
        `scale=${largura}:${altura},setsar=1[fundo]`,
      `[frente]scale=${largura}:${altura}:force_original_aspect_ratio=decrease,setsar=1[nitido]`,
      // `setsar=1` de novo depois do overlay: sem isso a virada de cena "pula"
      // de largura quando a origem tem pixel não-quadrado.
      '[fundo][nitido]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setsar=1,fps=30[v]',
    ].join(';');
  }

  /**
   * Iguala o volume entre peças e tira o estalo das emendas.
   *
   * O fade de saída precisa saber onde a peça termina; quando a duração não
   * pôde ser lida, entra só o de entrada — meio clique a menos ainda é melhor
   * que dois, e é melhor que arriscar um `st` negativo que o ffmpeg recusa.
   */
  private filtroDeAudio(duracao: number | null): string {
    const partes = [
      `loudnorm=I=${LOUDNESS_ALVO}:TP=-1.5:LRA=11`,
      `afade=t=in:st=0:d=${RAMPA_SEGUNDOS}`,
    ];
    if (duracao && duracao > RAMPA_SEGUNDOS * 2) {
      partes.push(
        `afade=t=out:st=${(duracao - RAMPA_SEGUNDOS).toFixed(3)}:d=${RAMPA_SEGUNDOS}`,
      );
    }
    return partes.join(',');
  }

  /**
   * Duração do arquivo, em segundos.
   *
   * Lê do stderr do próprio ffmpeg pelo mesmo motivo que `temAudio`: o pacote
   * `ffmpeg-static` não traz o ffprobe. Devolve `null` quando não achar, e quem
   * chama decide o que fazer sem a informação.
   */
  private async duracao(arquivo: string): Promise<number | null> {
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
    const pasta = await mkdtemp(join(tmpdir(), 'pikpok-duracao-'));
    // O nome vem de upload: só a extensão interessa, e o resto viraria caminho.
    const extensao = /\.([A-Za-z0-9]{1,5})$/.exec(nome)?.[1] ?? 'mp4';
    const arquivo = join(pasta, `entrada.${extensao.toLowerCase()}`);
    try {
      await writeFile(arquivo, buffer);
      return await this.duracao(arquivo);
    } catch (error) {
      this.logger.warn(`Não foi possível ler a duração do arquivo: ${error}`);
      return null;
    } finally {
      await this.limpar(pasta);
    }
  }

  /**
   * Recebe os MP4 das cenas na ordem do roteiro e devolve o vídeo final.
   * Trabalha em memória/tmp e limpa tudo ao terminar, inclusive em erro.
   */
  async juntar(
    cenas: Buffer[],
    dimensoes: { largura: number; altura: number } = {
      largura: LARGURA,
      altura: ALTURA,
    },
  ): Promise<Buffer> {
    const { largura, altura } = dimensoes;
    if (!ffmpegPath) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    if (!cenas.length) {
      throw new Error('Nenhuma cena pronta para montar.');
    }

    const normalizadas: Buffer[] = [];
    for (const cena of cenas) {
      normalizadas.push(await this.normalizar(cena, dimensoes));
    }
    return this.juntarNormalizadas(normalizadas);
  }

  /**
   * Deixa uma peça no formato comum de saída, pronta para ser concatenada.
   *
   * Está separado de `juntar` por causa do Multiplicador: lá os mesmos 18
   * clipes se repetem ao longo de até 150 combinações, e normalizar dentro do
   * laço de montagem re-codificava o mesmo gancho 15 vezes. Expondo esta etapa,
   * quem chama normaliza uma vez por clipe e reaproveita o resultado — o que
   * derruba o trabalho de ~450 codificações para 18 e é o que paga o preset
   * mais lento sem a montagem ficar mais demorada.
   *
   * O resultado é auto-contido: mesma resolução, mesmo fps, mesma taxa de
   * amostragem e sempre com faixa de áudio, que são as condições para o concat
   * rápido não produzir um arquivo que congela na virada.
   */
  async normalizar(
    cena: Buffer,
    dimensoes: { largura: number; altura: number } = {
      largura: LARGURA,
      altura: ALTURA,
    },
  ): Promise<Buffer> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    const { largura, altura } = dimensoes;
    const pasta = await mkdtemp(join(tmpdir(), 'pikpok-norm-'));
    try {
      const entrada = join(pasta, 'entrada.mp4');
      const saida = join(pasta, 'saida.mp4');
      await writeFile(entrada, cena);

      /**
       * Só inventa silêncio quando a cena vem MUDA.
       *
       * O concat descarta o áudio inteiro se um dos trechos não tiver faixa,
       * então toda cena precisa ter uma. Mas mapear silêncio sem checar
       * apagaria a narração das cenas que têm voz — que é o que o vendedor
       * está pagando para gerar.
       */
      const mudo = !(await this.temAudio(entrada));
      const duracao = mudo ? null : await this.duracao(entrada);

      await this.rodar([
        '-y',
        // Os dois `-i` vêm primeiro: opção de saída entre entradas é
        // atribuída ao arquivo errado e o ffmpeg recusa.
        '-i', entrada,
        ...(mudo
          ? ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']
          : []),
        '-filter_complex', this.filtroDeVideo(largura, altura),
        ...(mudo ? [] : ['-af', this.filtroDeAudio(duracao)]),
        '-c:v', 'libx264',
        // `medium` em vez de `veryfast`: com a normalização acontecendo uma vez
        // por clipe, o orçamento de CPU que sobrou vira qualidade de imagem. No
        // mesmo CRF, um preset mais lento gasta menos bits pelo mesmo detalhe.
        '-preset', 'medium',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-ac', '2',
        '-map', '[v]',
        '-map', mudo ? '1:a:0' : '0:a:0',
        // Corta pelo vídeo: sem isso a trilha infinita de silêncio nunca
        // termina e o ffmpeg fica gerando para sempre.
        ...(mudo ? ['-shortest'] : []),
        saida,
      ]);

      return await readFile(saida);
    } finally {
      await this.limpar(pasta);
    }
  }

  /**
   * Concatena peças JÁ normalizadas, sem recodificar.
   *
   * Só é seguro porque `normalizar` garante que todas saem idênticas em codec,
   * resolução e taxa de amostragem — é essa igualdade que o `-c copy` exige. Em
   * troca, a emenda custa milissegundos e a imagem não perde nada numa segunda
   * geração de compressão.
   */
  async juntarNormalizadas(partes: Buffer[]): Promise<Buffer> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    if (!partes.length) {
      throw new Error('Nenhuma cena pronta para montar.');
    }

    const pasta = await mkdtemp(join(tmpdir(), 'pikpok-montagem-'));
    try {
      const caminhos: string[] = [];
      for (const [i, parte] of partes.entries()) {
        const arquivo = join(pasta, `parte-${i}.mp4`);
        await writeFile(arquivo, parte);
        caminhos.push(arquivo);
      }

      const lista = join(pasta, 'lista.txt');
      await writeFile(
        lista,
        caminhos.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
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
      await this.limpar(pasta);
    }
  }

  private async limpar(pasta: string): Promise<void> {
    await rm(pasta, { recursive: true, force: true }).catch((error) =>
      this.logger.warn(`Não foi possível limpar ${pasta}: ${error}`),
    );
  }

  /**
   * A cena tem faixa de áudio?
   *
   * O `ffmpeg -i` sem saída sempre termina em erro — é o modo dele de só
   * descrever o arquivo. O que interessa é o texto, não o código de saída.
   * (O pacote não traz o ffprobe, então a leitura é daqui mesmo.)
   */
  private async temAudio(arquivo: string): Promise<boolean> {
    return /Stream #\d+:\d+.*: Audio:/.test(await this.inspecionar(arquivo));
  }

  /**
   * O relatório que o `ffmpeg -i` escreve no stderr sobre o arquivo.
   *
   * Sem arquivo de saída o comando sempre termina em erro — é o modo dele de
   * só descrever a entrada — então o `catch` é o caminho normal, não a exceção.
   */
  private async inspecionar(arquivo: string): Promise<string> {
    try {
      const { stderr } = await execFileAsync(ffmpegPath as string, [
        '-i', arquivo, '-hide_banner',
      ]);
      return stderr ?? '';
    } catch (error) {
      return (error as { stderr?: string }).stderr ?? '';
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
