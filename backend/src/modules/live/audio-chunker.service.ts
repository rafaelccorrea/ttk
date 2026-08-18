import { Injectable } from '@nestjs/common';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FfmpegRunner } from '../../common/media/ffmpeg-runner';

/**
 * Teto de tempo das chamadas de ffmpeg deste serviço.
 *
 * Extrair o áudio de uma live de 4h re-codifica a trilha inteira e é a etapa
 * cara; o fatiamento depois é cópia de stream e leva segundos. 20 minutos é
 * folga suficiente para a primeira sem deixar um processo travado vivo.
 */
const TIMEOUT_MS = 20 * 60_000;

/** Tamanho padrão de cada fatia, em segundos. 15 min é o meio-termo explicado em `fatiar`. */
const SEGUNDOS_POR_FATIA_PADRAO = 900;

/** Uma fatia de áudio em disco, com a duração real do arquivo. */
export interface FatiaDeAudio {
  caminho: string;
  /** Duração medida pelo ffmpeg. `null` só quando o arquivo é ilegível. */
  duracaoSec: number | null;
}

/**
 * Prepara a gravação de uma live para a transcrição.
 *
 * A entrada é o que o vendedor tem na mão: o MP4 de uma live de 2 a 4 horas,
 * com vídeo, na qualidade que o TikTok entregou. O que o Whisper precisa é o
 * oposto — só a voz, no menor arquivo possível, em pedaços que caibam numa
 * request. Este serviço faz essa ponte e nada além dela: não transcreve, não
 * interpreta, não persiste.
 *
 * Tudo aqui trabalha com CAMINHOS, nunca com `Buffer`. Um MP4 de live longa tem
 * gigabytes, e uma versão anterior mantinha em memória, ao mesmo tempo, o
 * upload inteiro, o ogg extraído e todas as fatias — três uploads simultâneos
 * derrubavam o processo da API por OOM, junto com todas as outras sessões em
 * andamento. Em disco, o pico de memória do pipeline passa a ser uma fatia.
 */
@Injectable()
export class AudioChunkerService {
  constructor(private readonly ffmpeg: FfmpegRunner) {}

  get enabled(): boolean {
    return this.ffmpeg.enabled;
  }

  /**
   * Extrai a trilha de voz da gravação e entrega ao `fn` num diretório de
   * trabalho que é apagado no fim, dê certo ou não.
   *
   * O MP4 de uma live de 4h tem alguns GB, e quase tudo é vídeo que ninguém vai
   * transcrever. Descartar a imagem (`-vn`), somar os canais em mono (`-ac 1`) e
   * codificar em Opus a 24kbps derruba isso para dezenas de MB — uma ordem de
   * grandeza a menos de disco, de rede e de tempo até a primeira request.
   *
   * A taxa parece agressiva e não é: 24kbps mono em Opus preserva a faixa de
   * frequência da fala com folga. O que se perde é fidelidade de música e de
   * ambiente — e o Whisper transcreve voz, não a trilha de fundo da live. O
   * estéreo também não ajuda em nada aqui: as duas pernas carregam a mesma voz.
   *
   * A duração vai junto porque quem chama precisa dela para cobrar a transcrição
   * pelo tempo real de áudio, e ela é lida do resultado (não da entrada) sem
   * custo — o arquivo já está em disco neste ponto. Pode vir `null` quando o
   * ffmpeg não conseguir descrever a saída; quem chama decide.
   *
   * A forma de callback existe para que o diretório sobreviva exatamente o tempo
   * do trabalho: as fatias produzidas por `fatiar` moram nele, e quem chama
   * precisa lê-las antes da limpeza.
   */
  async comAudioExtraido<T>(
    entradaPath: string,
    nome: string,
    fn: (ctx: {
      audioPath: string;
      durationSeconds: number | null;
      pasta: string;
    }) => Promise<T>,
  ): Promise<T> {
    if (!this.ffmpeg.enabled) {
      throw new Error(
        'ffmpeg não está disponível neste ambiente; não é possível extrair o áudio da live.',
      );
    }

    /*
     * A conferência vem ANTES da extração porque o fracasso dela é mudo.
     *
     * Sem trilha de áudio, o `-vn` abaixo descarta o vídeo e não sobra nada para
     * escrever: o ffmpeg morre com "Output file does not contain any stream",
     * essa linha sobe inteira até a tela da live e o vendedor recebe um erro de
     * ferramenta no lugar do fato — a gravação dele está sem som. Perguntar
     * antes custa uma leitura de cabeçalho e devolve a frase certa.
     */
    const streams = await this.ffmpeg.streamsDe(entradaPath);
    if (!streams.legivel) {
      throw new Error(
        'Não consegui ler este arquivo de vídeo. Envie a gravação da live num formato comum (MP4, MOV ou MKV) e confira se o envio terminou por completo.',
      );
    }
    /*
     * Áudio puro é recusado por decisão de produto, e não por limitação: o
     * pipeline extrairia a trilha de um MP3 sem reclamar. A regra e o porquê
     * moram em PREFIXOS_ACEITOS, no controller — aqui é a trava que o
     * `mimetype` não dá, já que ele é declarado por quem envia e um MP3 passa
     * renomeado como "video/mp4". Quem sabe o que o arquivo é de verdade é o
     * ffmpeg.
     */
    if (!streams.video) {
      throw new Error(
        'Este arquivo é só áudio. Envie o vídeo da live — é da gravação da transmissão, com imagem, que eu monto a base.',
      );
    }
    if (!streams.audio) {
      throw new Error(
        'Esta gravação não tem áudio. É da fala da live que eu monto a base de conhecimento, então preciso de um arquivo com som — confira se o microfone estava sendo gravado e envie de novo.',
      );
    }

    return this.ffmpeg.comTmp('pikpok-live-audio-', async (pasta) => {
      const saida = join(pasta, 'audio.ogg');

      await this.ffmpeg.rodar(
        [
          '-y',
          '-i', entradaPath,
          '-vn',
          '-ac', '1',
          '-c:a', 'libopus',
          '-b:a', '24k',
          '-f', 'ogg',
          saida,
        ],
        TIMEOUT_MS,
      );

      /*
       * Inteiro, sempre. O ffmpeg mede em fração de segundo (879.57), e essa
       * duração termina gravada em `live_sessions.duration_seconds`, que é
       * `int`: mandar o valor cru derrubava o processamento inteiro no fim com
       * `invalid input syntax for type integer`. Arredonda para cima porque a
       * duração alimenta a cobrança por bloco, e o segundo quebrado é áudio
       * que o Whisper transcreve de verdade.
       */
      const duracao = await this.ffmpeg.duracao(saida);

      return fn({
        audioPath: saida,
        durationSeconds: duracao === null ? null : Math.ceil(duracao),
        pasta,
      });
    });
  }

  /**
   * Corta o áudio já extraído em fatias sequenciais, gravadas em `destino`.
   *
   * Duas razões, e a segunda é a que importa mais. A primeira é dura: o Whisper
   * recusa qualquer request acima de 25MB, e mesmo comprimido a 24kbps uma live
   * longa passa disso. A segunda é operacional: uma request carregando 2 horas
   * de áudio é hostil mesmo quando cabe — ela demora, e qualquer falha no meio
   * (timeout, rate limit, queda de rede) joga fora o trabalho inteiro. Fatiado,
   * o mesmo tropeço custa uma fatia, que se reprocessa sozinha.
   *
   * O corte é feito com `-c copy`: as fatias já estão no codec final, então não
   * há nada a re-codificar e o ffmpeg só reescreve os pacotes em containers
   * novos. Isso também significa que o `-segment_time` é aproximado — o corte
   * cai na fronteira de pacote mais próxima, o que desloca a fatia por frações
   * de segundo.
   *
   * É justamente por esse deslocamento que a duração REAL de cada fatia volta
   * medida pelo ffmpeg, e não assumida como o tempo nominal: é ela que quem
   * transcreve usa para saber em que segundo da live cada fatia começa.
   */
  async fatiar(
    audioPath: string,
    destino: string,
    segundosPorFatia = SEGUNDOS_POR_FATIA_PADRAO,
  ): Promise<FatiaDeAudio[]> {
    if (!this.ffmpeg.enabled) {
      throw new Error(
        'ffmpeg não está disponível neste ambiente; não é possível fatiar o áudio da live.',
      );
    }
    if (!Number.isFinite(segundosPorFatia) || segundosPorFatia <= 0) {
      throw new Error('O tamanho da fatia precisa ser um número de segundos positivo.');
    }

    await this.ffmpeg.rodar(
      [
        '-y',
        '-i', audioPath,
        '-c', 'copy',
        '-f', 'segment',
        '-segment_time', String(Math.round(segundosPorFatia)),
        // Três dígitos no padrão: 4h em fatias de 15min dá 16 arquivos, e o
        // teto de 1000 cobre live de qualquer tamanho que valha transcrever.
        join(destino, 'out%03d.ogg'),
      ],
      TIMEOUT_MS,
    );

    /**
     * A ordem aqui é a linha do tempo da live, não um detalhe de leitura.
     *
     * O `readdir` não promete ordem nenhuma, e a transcrição montada fora de
     * ordem viraria uma base de conhecimento com preços e objeções embaralhados
     * entre produtos — um defeito silencioso, que só aparece quando alguém lê o
     * resultado. Os nomes vêm com zeros à esquerda justamente para que a
     * ordenação alfabética já seja a cronológica.
     */
    const arquivos = (await readdir(destino))
      .filter((f) => /^out\d+\.ogg$/.test(f))
      .sort();

    if (!arquivos.length) {
      throw new Error('O ffmpeg não gerou nenhuma fatia de áudio da live.');
    }

    const fatias: FatiaDeAudio[] = [];
    for (const arquivo of arquivos) {
      const caminho = join(destino, arquivo);
      fatias.push({ caminho, duracaoSec: await this.ffmpeg.duracao(caminho) });
    }
    return fatias;
  }
}
