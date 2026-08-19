import { Injectable, Logger } from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FfmpegRunner } from '../../common/media/ffmpeg-runner';

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

  constructor(private readonly ffmpeg: FfmpegRunner) {}

  get enabled(): boolean {
    return this.ffmpeg.enabled;
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
   * A fala da cena queimada como legenda no terço de baixo do quadro.
   *
   * É o que fecha o buraco entre promessa e entrega: o vendedor revisa cada
   * fala com cuidado, mas a geração de vídeo só recebe a ação visual — o clipe
   * sai mudo. Até o TTS existir, a legenda é o que faz a fala aparecer no
   * vídeo publicado (e no TikTok a maioria assiste sem som mesmo).
   *
   * O texto é quebrado aqui, não pelo ffmpeg: o drawtext não quebra linha
   * sozinho, e uma fala de 15 palavras numa linha única sai do quadro.
   */
  private filtroDeLegenda(texto: string, largura: number): string | null {
    const limpo = texto.trim().replace(/\s+/g, ' ');
    if (!limpo) return null;

    // ~26 colunas cabem em 1080px com a fonte em ~1/16 da largura.
    const porLinha = 26;
    const linhas: string[] = [];
    let atual = '';
    for (const palavra of limpo.split(' ')) {
      if ((atual + ' ' + palavra).trim().length > porLinha && atual) {
        linhas.push(atual);
        atual = palavra;
      } else {
        atual = (atual + ' ' + palavra).trim();
      }
    }
    if (atual) linhas.push(atual);

    /*
     * O texto vai entre aspas simples, e DENTRO delas o parser do
     * filtergraph é literal: dois-pontos e vírgula não precisam (nem podem)
     * ser escapados — um "\:" apareceria escrito na legenda. Só três coisas
     * quebram: o apóstrofo cru (ENCERRA o argumento e o resto da fala vira
     * opção de filtro — vira apóstrofo tipográfico), a contrabarra, e a
     * sequência "%{" da expansão do drawtext.
     */
    const escapar = (l: string) =>
      l
        .replace(/\\/g, '')
        .replace(/'/g, "\u2019")
        .replace(/%\{/g, '% {');

    const fontsize = Math.round(largura / 16);
    const interlinha = Math.round(fontsize * 1.3);
    // Uma chamada de drawtext por linha: o filtro não tem "multilinha" de
    // verdade, e empilhar com y calculado é o caminho estável entre builds.
    return linhas
      .slice(0, 3)
      .map(
        (linha, i, todas) =>
          `drawtext=text='${escapar(linha)}':fontcolor=white:fontsize=${fontsize}:` +
          `borderw=${Math.max(2, Math.round(fontsize / 12))}:bordercolor=black@0.85:` +
          `x=(w-text_w)/2:y=h-${Math.round(largura * 0.42) - (todas.length - 1 - i) * interlinha}`,
      )
      .join(',');
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
   * Substitui a trilha de áudio do clipe pela narração TTS.
   *
   * O clipe chega com a "fala" que o modelo de vídeo inventou — em português
   * quebrado a ponto de não se entender. Trocar a trilha inteira (em vez de
   * mixar) é deliberado: o áudio original é o defeito, não um fundo a
   * preservar.
   *
   * Quando a narração é mais longa que o clipe, acelera até 1,35× (acima
   * disso soa picotado; melhor cortar o rabo da frase do que virar leilão).
   * Mais curta, completa com silêncio até o fim do vídeo.
   */
  async dublar(video: Buffer, narracao: Buffer): Promise<Buffer> {
    if (!this.ffmpeg.enabled) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    return this.ffmpeg.comTmp('pikpok-dub-', async (pasta) => {
      const entrada = join(pasta, 'entrada.mp4');
      const voz = join(pasta, 'voz.mp3');
      const saida = join(pasta, 'saida.mp4');
      await writeFile(entrada, video);
      await writeFile(voz, narracao);

      const duracaoVideo = await this.ffmpeg.duracao(entrada);
      const duracaoVoz = await this.ffmpeg.duracao(voz);
      const atempo =
        duracaoVideo && duracaoVoz && duracaoVoz > duracaoVideo
          ? Math.min(1.35, duracaoVoz / duracaoVideo)
          : 1;

      /*
       * O áudio é CORTADO pelo filtro (`atrim`), nunca pelo `-shortest`.
       *
       * Com o vídeo em `-c:v copy`, os pacotes de vídeo drenam para o muxer
       * de uma vez e o `-shortest` não tem "corrida" para encerrar — enquanto
       * o `apad` segue gerando silêncio para sempre. Em produção o processo
       * ficava pendurado até o timeout de 5 minutos matá-lo, e a redublagem
       * "falhava" sem uma linha de erro no log, todas as vezes.
       */
      const limite = duracaoVideo
        ? `,atrim=0:${duracaoVideo.toFixed(3)}`
        : '';

      await this.ffmpeg.rodar(
        [
          '-y',
          '-i', entrada,
          '-i', voz,
          '-filter_complex',
          `[1:a]atempo=${atempo.toFixed(3)},apad${limite}[a]`,
          '-map', '0:v',
          '-map', '[a]',
          // O vídeo não é tocado: recodificar aqui degradaria a imagem duas
          // vezes (a normalização da montagem ainda vem depois).
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '44100',
          '-ac', '2',
          // Só quando a duração não pôde ser lida — aí o -shortest é o único
          // freio que resta, e o timeout é a rede de segurança.
          ...(duracaoVideo ? [] : ['-shortest']),
          saida,
        ],
        TIMEOUT_MS,
      );
      return await readFile(saida);
    });
  }

  /**
   * Duração de um arquivo que ainda está em memória, em segundos.
   *
   * Continua exposto aqui porque o Studio pede a duração do upload antes de
   * saber se vai montar alguma coisa — quem chama já tem este serviço em mãos.
   */
  async duracaoDoBuffer(buffer: Buffer, nome = 'entrada.mp4'): Promise<number | null> {
    return this.ffmpeg.duracaoDoBuffer(buffer, nome);
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
    /** Fala de cada cena, na mesma ordem — vira legenda queimada no quadro. */
    legendas: Array<string | null> = [],
  ): Promise<Buffer> {
    if (!this.ffmpeg.enabled) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    if (!cenas.length) {
      throw new Error('Nenhuma cena pronta para montar.');
    }

    const normalizadas: Buffer[] = [];
    for (const [i, cena] of cenas.entries()) {
      normalizadas.push(await this.normalizar(cena, dimensoes, legendas[i] ?? null));
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
    legenda: string | null = null,
  ): Promise<Buffer> {
    if (!this.ffmpeg.enabled) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    /*
     * A legenda depende do drawtext, e drawtext depende de haver FONTE no
     * servidor — coisa que muda de build para build do ffmpeg. Se a passada
     * com legenda falhar, o vídeo sai sem ela: um final mudo porém montado é
     * entregável; um erro na montagem inteira por causa de texto, não.
     */
    if (legenda) {
      try {
        return await this.normalizarInterno(cena, dimensoes, legenda);
      } catch (error) {
        this.logger.warn(`Legenda falhou, montando sem ela: ${error}`);
      }
    }
    return this.normalizarInterno(cena, dimensoes, null);
  }

  private async normalizarInterno(
    cena: Buffer,
    dimensoes: { largura: number; altura: number },
    legenda: string | null,
  ): Promise<Buffer> {
    const { largura, altura } = dimensoes;
    return this.ffmpeg.comTmp('pikpok-norm-', async (pasta) => {
      const entrada = join(pasta, 'entrada.mp4');
      const saida = join(pasta, 'saida.mp4');
      await writeFile(entrada, cena);

      /**
       * Só inventa silêncio quando a cena vem MUDA — e "mudo" tem que vir do
       * PRÓPRIO ffmpeg, não de uma sonda que pode falhar.
       *
       * O concat descarta o áudio inteiro se um dos trechos não tiver faixa,
       * então toda cena precisa ter uma. Mas em produção a sonda de áudio
       * respondeu "mudo" para uma cena COM voz (o log mostrava o stream aac e
       * a normalização entrando com anullsrc) e o vídeo final saiu em
       * silêncio. Por isso a ordem inverteu: primeiro tenta com o áudio real;
       * se o ffmpeg disser que o stream não existe, refaz como mudo. Errar
       * para o lado do retry custa um spawn; errar para o do silêncio custava
       * a voz que o vendedor pagou.
       */
      const sonda = await this.ffmpeg.inspecionar(entrada);
      const pareceMudo = sonda !== '' && !/Stream #\d+:\d+.*:\s*Audio:/i.test(sonda);
      if (!pareceMudo) {
        try {
          return await this.codificar(entrada, saida, largura, altura, legenda, false);
        } catch (error) {
          const msg = String(error);
          if (!/matches no streams|Invalid stream specifier/i.test(msg)) throw error;
          this.logger.warn('Cena sem faixa de áudio de verdade; refazendo como muda.');
        }
      }
      return await this.codificar(entrada, saida, largura, altura, legenda, true);
    });
  }

  /** Uma passada de normalização, com ou sem a faixa de áudio original. */
  private async codificar(
    entrada: string,
    saida: string,
    largura: number,
    altura: number,
    legenda: string | null,
    mudo: boolean,
  ): Promise<Buffer> {
      const duracao = mudo ? null : await this.ffmpeg.duracao(entrada);

      await this.ffmpeg.rodar(
        [
          '-y',
          // Os dois `-i` vêm primeiro: opção de saída entre entradas é
          // atribuída ao arquivo errado e o ffmpeg recusa.
          '-i', entrada,
          ...(mudo
            ? ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']
            : []),
          '-filter_complex',
          (() => {
            const base = this.filtroDeVideo(largura, altura);
            const texto = legenda ? this.filtroDeLegenda(legenda, largura) : null;
            // A legenda entra no fim da cadeia do [v]: depois do overlay, o
            // quadro já está no tamanho final e o texto não é reescalado.
            return texto ? base.replace(',fps=30[v]', `,fps=30,${texto}[v]`) : base;
          })(),
          ...(mudo ? [] : ['-af', this.filtroDeAudio(duracao)]),
          '-c:v', 'libx264',
          /*
           * `veryfast` + 2 threads: o preset não é escolha estética, é o que
           * CABE na hospedagem. Com `medium` e threads automáticas o x264
           * tentava alocar buffers para todos os núcleos da máquina
           * compartilhada, o limite de memória do LVE negava, e o encoder
           * morria em "Error while opening encoder" — a montagem inteira caía.
           * O custo visual do preset mais rápido é pequeno; a montagem não
           * acontecer custava o produto.
           */
          '-preset', 'veryfast',
          '-threads', '2',
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
        ],
        TIMEOUT_MS,
      );

      return await readFile(saida);
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
    if (!this.ffmpeg.enabled) {
      throw new Error('ffmpeg não está disponível neste ambiente.');
    }
    if (!partes.length) {
      throw new Error('Nenhuma cena pronta para montar.');
    }

    return this.ffmpeg.comTmp('pikpok-montagem-', async (pasta) => {
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
      await this.ffmpeg.rodar(
        [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', lista,
          '-c', 'copy',
          // `+faststart` põe o índice no começo: o vídeo começa a tocar antes de
          // baixar inteiro, que é como o navegador espera.
          '-movflags', '+faststart',
          final,
        ],
        TIMEOUT_MS,
      );

      return await readFile(final);
    });
  }

  /**
   * A cena tem faixa de áudio?
   *
   * O `ffmpeg -i` sem saída sempre termina em erro — é o modo dele de só
   * descrever o arquivo. O que interessa é o texto, não o código de saída.
   */
  private async temAudio(arquivo: string): Promise<boolean> {
    return /Stream #\d+:\d+.*: Audio:/.test(await this.ffmpeg.inspecionar(arquivo));
  }
}
