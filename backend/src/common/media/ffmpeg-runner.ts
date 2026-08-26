import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { access, chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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

  /**
   * Garante o +x no binário UMA vez por processo.
   *
   * O deploy da Hostinger extrai cada versão numa pasta nova e o bit de
   * execução do `ffmpeg-static` não sobrevive à extração — o spawn morria
   * com EACCES e derrubava a montagem do vídeo final em produção. O chmod é
   * idempotente e custa um stat; falhar aqui não derruba nada, porque o erro
   * real (e legível) aparece no spawn logo em seguida.
   */
  private permissaoGarantida = false;

  /**
   * Fila de execução: UM ffmpeg por vez neste processo.
   *
   * A hospedagem compartilhada limita processos e memória por conta (LVE).
   * Quando a montagem do vídeo final e uma dublagem coincidiam — e o polling
   * torna isso rotina —, o segundo ffmpeg era morto pelo limite SEM linha de
   * erro: o log parava nos headers de saída e a operação "falhava do nada".
   * Serializar custa segundos de espera; a concorrência custava a operação.
   */
  private fila: Promise<unknown> = Promise.resolve();

  private enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
    const execucao = this.fila.then(tarefa, tarefa);
    // A fila nunca pode rejeitar, senão um erro antigo derruba o próximo.
    this.fila = execucao.catch(() => undefined);
    return execucao;
  }

  private async garantirExecutavel(): Promise<void> {
    if (this.permissaoGarantida || !ffmpegPath) {
      this.permissaoGarantida = true;
      return;
    }
    /*
     * `ffmpegPath` é só uma string montada pelo pacote — o binário em si é
     * baixado num postinstall, e um deploy que pulou ou bloqueou esse download
     * deixa o caminho apontando para o nada. Aí todo spawn morre em ENOENT com
     * stderr vazio e o sintoma vira "arquivo ilegível" na live. Uma linha de
     * log no primeiro uso responde isso de vez.
     */
    try {
      await access(ffmpegPath as string);
    } catch {
      this.logger.error(
        `Binário do ffmpeg NÃO existe em "${ffmpegPath}" — o download do ffmpeg-static falhou neste deploy (rode "npm rebuild ffmpeg-static").`,
      );
    }
    if (process.platform !== 'win32') {
      try {
        await chmod(ffmpegPath as string, 0o755);
      } catch (error) {
        this.logger.warn(`chmod no ffmpeg falhou: ${error}`);
      }
    }
    this.permissaoGarantida = true;
  }

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
    await this.garantirExecutavel();
    try {
      await this.enfileirar(() =>
        execFileAsync(ffmpegPath as string, args, {
          timeout: timeoutMs,
          maxBuffer: 32 * 1024 * 1024,
        }),
      );
    } catch (error) {
      // O ffmpeg escreve o motivo real no stderr; sem isso o erro vira só
      // "Command failed" e não dá para saber o que quebrou.
      const stderr = (error as { stderr?: string }).stderr ?? '';
      const ultima = stderr.trim().split('\n').slice(-3).join(' ');
      throw new Error(`ffmpeg falhou: ${ultima || (error as Error).message}`);
    }
  }

  /**
   * Roda um ffmpeg que TERMINA BEM e devolve o stderr dele.
   *
   * Existe para os filtros de análise (`silencedetect`, `volumedetect`), que
   * não produzem arquivo nenhum: o resultado é o relatório que o filtro
   * escreve no stderr, e `rodar` descarta esse texto. Passa pela mesma fila.
   */
  async rodarLendoStderr(args: string[], timeoutMs = TIMEOUT_PADRAO_MS): Promise<string> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    await this.garantirExecutavel();
    try {
      const { stderr } = await this.enfileirar(() =>
        execFileAsync(ffmpegPath as string, args, {
          timeout: timeoutMs,
          maxBuffer: 32 * 1024 * 1024,
        }),
      );
      return stderr ?? '';
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      const ultima = stderr.trim().split('\n').slice(-3).join(' ');
      throw new Error(`ffmpeg falhou: ${ultima || (error as Error).message}`);
    }
  }

  /**
   * Os trechos de silêncio do áudio, em segundos desde o início.
   *
   * É a base do modo rápido dos Cortes: uma janela que termina dentro de um
   * silêncio não corta ninguém no meio da frase. `ruidoDb` é o piso abaixo do
   * qual o ffmpeg considera silêncio; `minSeg` é o mínimo de duração para um
   * trecho contar — pausas de respiração (0,2 s) não servem para cortar, uma
   * pausa entre assuntos (0,5 s+) serve.
   *
   * Um arquivo sem trilha de áudio devolve lista vazia, não erro: o chamador
   * cai para janelas fixas.
   */
  async silencios(
    arquivo: string,
    opts: { ruidoDb?: number; minSeg?: number; timeoutMs?: number } = {},
  ): Promise<Array<{ inicio: number; fim: number }>> {
    const ruido = opts.ruidoDb ?? -35;
    const minimo = opts.minSeg ?? 0.5;
    let relatorio = '';
    try {
      relatorio = await this.rodarLendoStderr(
        [
          '-hide_banner',
          '-i', arquivo,
          '-vn',
          '-af', `silencedetect=noise=${ruido}dB:d=${minimo}`,
          '-f', 'null',
          '-',
        ],
        opts.timeoutMs,
      );
    } catch (error) {
      this.logger.warn(`silencedetect falhou em "${arquivo}": ${error}`);
      return [];
    }
    const trechos: Array<{ inicio: number; fim: number }> = [];
    let aberto: number | null = null;
    for (const linha of relatorio.split('\n')) {
      const ini = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(linha);
      if (ini) {
        aberto = Math.max(0, Number(ini[1]));
        continue;
      }
      const fim = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(linha);
      if (fim && aberto !== null) {
        trechos.push({ inicio: aberto, fim: Math.max(aberto, Number(fim[1])) });
        aberto = null;
      }
    }
    return trechos;
  }

  /**
   * Recorta `[inicioSeg, fimSeg]` da fonte num MP4 pronto para postar.
   *
   * Sempre re-codifica: `-c copy` só corta em keyframe e desloca o corte em
   * até alguns segundos — num vídeo de 30 s isso é o gancho inteiro fora. O
   * `-ss` vem ANTES do `-i` (busca rápida pelo índice) e o `-to` depois é
   * relativo a esse ponto, por isso vai como duração.
   *
   * Enquadramento (720p na proporção pedida), por `opcoes.rosto`:
   * - sem trilha: o vídeo inteiro centralizado sobre uma cópia ampliada e
   *   desfocada — o layout dos apps de corte para horizontal em 9:16. Fonte já
   *   na proporção sai idêntica a um crop.
   * - com trilha: a fonte é escalada para preencher a altura e um `crop`
   *   animado segue o centro do rosto (interpolação linear entre amostras).
   *
   * `veryfast` + CRF 26 é o compromisso do host compartilhado: alguns segundos
   * de CPU por corte e ~25 MB no pior caso (90 s), abaixo do teto do bucket.
   */
  async cortar(
    fonte: string,
    saida: string,
    inicioSeg: number,
    fimSeg: number,
    formato: '9:16' | '16:9' | '1:1' = '9:16',
    timeoutMs = TIMEOUT_PADRAO_MS,
    /**
     * Arquivo .srt com os tempos RELATIVOS ao início do corte, para queimar a
     * legenda no vídeo (filtro `subtitles`, libass). O visual vem de
     * `opcoes.estilo`; o padrão é branco com contorno preto no terço de baixo.
     */
    legendaSrt?: string,
    opcoes: OpcoesDeCorte = {},
  ): Promise<void> {
    const duracao = Math.max(0.5, fimSeg - inicioSeg);
    const [larg, alt] =
      formato === '16:9' ? [1280, 720] : formato === '1:1' ? [720, 720] : [720, 1280];
    const etapas = [
      opcoes.rosto?.length ? enquadrarNoRosto(larg, alt, opcoes.rosto) : enquadrarComBlur(larg, alt),
      'setsar=1',
      'fps=30',
    ];
    if (legendaSrt) {
      /*
       * O caminho entra dentro de uma expressão de filtro, que trata `:` e
       * `\` como sintaxe — no Windows `C:\tmp\x.srt` viraria três argumentos.
       * Barras normais + `:` escapado é a forma que funciona nos dois SOs.
       * `fontsdir` aponta para uma pasta de fontes nossa quando o servidor
       * não tem nenhuma instalada (caso do host compartilhado).
       */
      const caminho = legendaSrt.replace(/\\/g, '/').replace(/:/g, '\\:');
      /*
       * A fonte vai no repo (`backend/assets/fonts`, DejaVu Sans, licença
       * livre) porque o host compartilhado não tem fonte nenhuma instalada e
       * o libass, sem fonte, desenha nada — o corte sairia sem legenda e sem
       * erro. `__dirname` resolve tanto de `src/` (jest/ts-node) quanto de
       * `dist/` (prod): os dois estão a três níveis de `backend/`.
       * `CUTS_FONTS_DIR` continua valendo para apontar outra pasta.
       */
      const pastaDeFontes =
        process.env.CUTS_FONTS_DIR || join(__dirname, '..', '..', '..', 'assets', 'fonts');
      const fontsdir = `:fontsdir='${pastaDeFontes.replace(/\\/g, '/').replace(/:/g, '\\:')}'`;
      const estilo = estiloDeLegenda(opcoes.estilo ?? 'classico', formato === '9:16');
      etapas.push(`subtitles='${caminho}'${fontsdir}:force_style='${estilo}'`);
    }
    const filtro = etapas.join(',');
    await this.rodar(
      [
        '-y',
        '-hide_banner',
        '-ss', inicioSeg.toFixed(3),
        '-i', fonte,
        '-t', duracao.toFixed(3),
        '-vf', filtro,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '26',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-movflags', '+faststart',
        saida,
      ],
      timeoutMs,
    );
  }

  /**
   * Amostra quadros da fonte a `fps` por segundo, em JPEG pequeno, para
   * análise (detecção de rosto). Devolve os caminhos em ordem de tempo; o
   * quadro `i` está em `inicioSeg + i / fps`.
   */
  async amostrarQuadros(
    fonte: string,
    pasta: string,
    inicioSeg: number,
    duracaoSeg: number,
    opts: { fps?: number; largura?: number; timeoutMs?: number } = {},
  ): Promise<string[]> {
    const fps = opts.fps ?? 1;
    const largura = opts.largura ?? 320;
    const padrao = join(pasta, 'q-%04d.jpg');
    await this.rodar(
      [
        '-y',
        '-hide_banner',
        '-ss', inicioSeg.toFixed(3),
        '-i', fonte,
        '-t', duracaoSeg.toFixed(3),
        '-vf', `fps=${fps},scale=${largura}:-2`,
        '-q:v', '5',
        padrao,
      ],
      opts.timeoutMs ?? TIMEOUT_PADRAO_MS,
    );
    const nomes = (await readdir(pasta)).filter((n) => /^q-\d{4}\.jpg$/.test(n)).sort();
    return nomes.map((n) => join(pasta, n));
  }

  /**
   * O relatório que o `ffmpeg -i` escreve no stderr sobre o arquivo.
   *
   * Sem arquivo de saída o comando sempre termina em erro — é o modo dele de
   * só descrever a entrada — então o `catch` é o caminho normal, não a exceção.
   */
  async inspecionar(arquivo: string): Promise<string> {
    if (!ffmpegPath) return '';
    await this.garantirExecutavel();
    // Passa pela fila como qualquer outro ffmpeg: rodando em paralelo com uma
    // extração, o LVE matava a sondagem sem stderr e o arquivo bom era
    // diagnosticado como ilegível.
    return this.enfileirar(async () => {
      try {
        const { stderr } = await execFileAsync(ffmpegPath as string, [
          '-i', arquivo, '-hide_banner',
        ]);
        return stderr ?? '';
      } catch (error) {
        let stderr = (error as { stderr?: string }).stderr ?? '';
        if (!stderr.trim()) {
          /*
           * No Node da Hostinger o `error.stderr` do execFile chega VAZIO e o
           * relatório do ffmpeg vem embutido no `message`, depois da linha
           * "Command failed: <comando>". Sem este resgate, todo arquivo — até
           * o perfeito — era diagnosticado como "o ffmpeg nem rodou", porque o
           * `-i` sem saída sempre termina em erro e o stderr é o relatório.
           */
          const linhas = ((error as Error).message ?? '').split('\n');
          if (/^Command failed:/.test(linhas[0] ?? '')) {
            stderr = linhas.slice(1).join('\n');
          }
        }
        if (!stderr.trim()) {
          // Agora sim: nada em lugar nenhum = o ffmpeg nem chegou a reclamar
          // do arquivo. ENOENT = binário ausente no deploy, EACCES = chmod não
          // pegou, SIGKILL = LVE matou o processo.
          const e = error as NodeJS.ErrnoException & { signal?: string };
          this.logger.error(
            `ffmpeg não descreveu "${arquivo}": code=${e.code ?? '?'} signal=${e.signal ?? '?'} ${e.message}`,
          );
        }
        return stderr;
      }
    });
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
  async streamsDe(
    arquivo: string,
  ): Promise<{ sondou: boolean; legivel: boolean; audio: boolean; video: boolean }> {
    const saida = await this.inspecionar(arquivo);
    return {
      /*
       * `sondou: false` = o ffmpeg nem chegou a descrever o arquivo (morto
       * pelo LVE, binário sem +x, restart de deploy). É falha NOSSA, não do
       * arquivo — um arquivo ruim de verdade produz stderr com o motivo
       * ("Invalid data found..."). Sem essa separação, todo kill de processo
       * virava "seu vídeo está corrompido" na tela do vendedor.
       */
      sondou: saida.trim().length > 0,
      legivel: /Stream #\d+:\d+/.test(saida),
      audio: /Stream #\d+:\d+.*:\s*Audio:/i.test(saida),
      /*
       * `video: true` diz que há IMAGEM, e é por isso que a capa embutida num
       * MP3 precisa ficar de fora: o ffmpeg a reporta como stream de vídeo
       * (mjpeg/png) e um teste ingênuo aprovaria o áudio disfarçado. O
       * `attached pic` é a marca que ele põe nesses casos.
       */
      video: saida
        .split('\n')
        .some(
          (linha) =>
            /Stream #\d+:\d+.*:\s*Video:/i.test(linha) &&
            !/attached pic/i.test(linha) &&
            !/Video:\s*(mjpeg|png|bmp|gif)\b/i.test(linha),
        ),
    };
  }

  /** Duração do arquivo em segundos, ou `null` quando não der para ler. */
  /**
   * Largura × altura do primeiro stream de vídeo, já corrigidas pela rotação
   * dos metadados (celular grava "deitado" e marca rotate=90: o arquivo diz
   * 1920×1080, mas o que se vê é 1080×1920).
   */
  async dimensoes(arquivo: string): Promise<{ largura: number; altura: number } | null> {
    const saida = await this.inspecionar(arquivo);
    const m = /Stream #\d+:\d+.*Video:.*?\s(\d{2,5})x(\d{2,5})[\s,]/.exec(saida);
    if (!m) return null;
    let largura = Number(m[1]);
    let altura = Number(m[2]);
    const rot = /rotate\s*:\s*(-?\d+)/i.exec(saida) ?? /displaymatrix:.*?(-?\d+)\.\d+ degrees/i.exec(saida);
    if (rot && Math.abs(Number(rot[1])) % 180 === 90) [largura, altura] = [altura, largura];
    return { largura, altura };
  }

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

/** Perfis da legenda queimada — espelho de `CAPTION_STYLES` no planner dos cortes. */
export type EstiloDeLegenda = 'classico' | 'karaoke' | 'impacto' | 'minimal' | 'oferta';

/** Centro do rosto ao longo do corte: `t` em segundos desde o início, `cx` em 0–1 da largura. */
export interface PontoDeRosto {
  t: number;
  cx: number;
}

export interface OpcoesDeCorte {
  estilo?: EstiloDeLegenda;
  /** Trilha do rosto; presente = crop animado em vez de fundo desfocado. */
  rosto?: PontoDeRosto[];
}

/**
 * Vídeo inteiro encaixado no centro (`decrease`) sobre uma cópia ampliada e
 * desfocada (`increase` + crop + boxblur). O crop central de antes jogava fora
 * ~70% da largura de um 16:9 e deixava só o miolo.
 */
function enquadrarComBlur(larg: number, alt: number): string {
  const fundo =
    `[bg]scale=${larg}:${alt}:force_original_aspect_ratio=increase,` +
    `crop=${larg}:${alt},boxblur=20:5[bgb]`;
  const frente = `[fg]scale=${larg}:${alt}:force_original_aspect_ratio=decrease[fgs]`;
  return `split=2[bg][fg];${fundo};${frente};[bgb][fgs]overlay=(W-w)/2:(H-h)/2`;
}

/**
 * Escala a fonte para preencher a altura e recorta `larg` px seguindo o rosto.
 *
 * O `x` do crop é uma expressão em `t`: interpolação linear entre as amostras
 * da trilha (aninhando `if(lt(t,…))`), com o centro convertido em pixels da
 * largura ESCALADA (`in_w`) e preso às bordas. Antes da primeira amostra vale
 * a primeira; depois da última, a última. A trilha já chega suavizada pelo
 * detector, então aqui é só geometria. `force_original_aspect_ratio=increase`
 * garante que, mesmo numa fonte quase quadrada, o quadro cobre o formato.
 */
export function enquadrarNoRosto(larg: number, alt: number, trilha: PontoDeRosto[]): string {
  const pontos = [...trilha].sort((a, b) => a.t - b.t);
  const n = (v: number) => v.toFixed(4);
  let expr = n(pontos[pontos.length - 1].cx);
  for (let i = pontos.length - 2; i >= 0; i -= 1) {
    const p = pontos[i];
    const q = pontos[i + 1];
    const dt = Math.max(0.001, q.t - p.t);
    const lerp = `${n(p.cx)}+(${n(q.cx - p.cx)})*(t-${n(p.t)})/${n(dt)}`;
    expr = `if(lt(t,${n(q.t)}),${lerp},${expr})`;
  }
  const x = `clip((${expr})*in_w-${larg}/2,0,in_w-${larg})`;
  return (
    `scale=${larg}:${alt}:force_original_aspect_ratio=increase,` +
    `crop=${larg}:${alt}:x='${x}':y=(in_h-${alt})/2`
  );
}

/**
 * `force_style` do libass por perfil.
 *
 * As medidas NÃO são pixels: um SRT vira ASS com PlayResX=384 / PlayResY=288
 * e o libass escala tudo a partir daí. Em 720×1280, FontSize=16 dá ~70 px de
 * altura de letra e MarginV=48 põe a linha a ~17% do fundo — o terço de
 * baixo, fora do rosto e acima da barra do TikTok. Cores são &HAABBGGRR.
 * Karaokê e oferta fazem o destaque no próprio SRT (`<font color>`), então
 * aqui só mudam a base.
 */
export function estiloDeLegenda(estilo: EstiloDeLegenda, vertical: boolean): string {
  const fonte = `FontName=${process.env.CUTS_FONT_NAME || 'DejaVu Sans'}`;
  const base = [fonte, 'Alignment=2', `MarginV=${vertical ? 48 : 24}`, 'MarginL=20', 'MarginR=20', 'Shadow=0'];
  const porEstilo: Record<EstiloDeLegenda, string[]> = {
    classico: [
      `FontSize=${vertical ? 16 : 13}`,
      'Bold=1',
      'PrimaryColour=&H00FFFFFF',
      'OutlineColour=&H00000000',
      'BorderStyle=1',
      'Outline=2',
    ],
    karaoke: [
      `FontSize=${vertical ? 17 : 13}`,
      'Bold=1',
      'PrimaryColour=&H00FFFFFF',
      'OutlineColour=&H00000000',
      'BorderStyle=1',
      'Outline=2',
    ],
    impacto: [
      `FontSize=${vertical ? 19 : 14}`,
      'Bold=1',
      'PrimaryColour=&H0000D5FF',
      'OutlineColour=&H00000000',
      'BorderStyle=1',
      'Outline=3',
      'Spacing=1',
    ],
    minimal: [
      `FontSize=${vertical ? 13 : 11}`,
      'Bold=0',
      'PrimaryColour=&H00FFFFFF',
      'BackColour=&H99000000',
      'OutlineColour=&H99000000',
      // BorderStyle=3 desenha uma caixa opaca atrás do texto (a "tarja").
      'BorderStyle=3',
      'Outline=3',
    ],
    oferta: [
      `FontSize=${vertical ? 18 : 14}`,
      'Bold=1',
      'PrimaryColour=&H00FFFFFF',
      'OutlineColour=&H00000000',
      'BorderStyle=1',
      'Outline=3',
    ],
  };
  return [...base, ...porEstilo[estilo]].join(',');
}
