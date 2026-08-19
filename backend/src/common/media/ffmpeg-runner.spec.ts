import { FfmpegRunner } from './ffmpeg-runner';

/**
 * O que estes testes protegem é a LEITURA do relatório do ffmpeg, não o ffmpeg.
 *
 * `streamsDe` decide, a partir de texto, se a gravação da live vira base de
 * conhecimento ou vira um erro na tela do vendedor — e ela lê a saída de uma
 * ferramenta externa, que é justamente o tipo de contrato que muda sem avisar.
 * Por isso as amostras abaixo são recortes REAIS do stderr, e não frases
 * inventadas para casar com a expressão regular.
 *
 * `inspecionar` é substituído em vez de rodar o binário: o teste precisa ser o
 * mesmo em qualquer máquina, inclusive nas de CI onde não há ffmpeg.
 */
describe('FfmpegRunner.streamsDe', () => {
  function comRelatorio(saida: string): FfmpegRunner {
    const runner = new FfmpegRunner();
    jest.spyOn(runner, 'inspecionar').mockResolvedValue(saida);
    return runner;
  }

  const COM_AUDIO = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'live.mp4':
  Duration: 01:12:33.40, start: 0.000000, bitrate: 2210 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1080x1920, 2080 kb/s
  Stream #0:1[0x2](und): Audio: aac (LC), 44100 Hz, stereo, fltp, 128 kb/s
`;

  const SEM_AUDIO = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'live.mp4':
  Duration: 00:41:02.11, start: 0.000000, bitrate: 1980 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1080x1920, 1975 kb/s
`;

  const ILEGIVEL = `
live.mp4: Invalid data found when processing input
`;

  it('reconhece a gravação completa — imagem e som', async () => {
    await expect(comRelatorio(COM_AUDIO).streamsDe('live.mp4')).resolves.toEqual({
      sondou: true,
      legivel: true,
      audio: true,
      video: true,
    });
  });

  it('reconhece a gravação muda — tem vídeo, não tem som', async () => {
    await expect(comRelatorio(SEM_AUDIO).streamsDe('live.mp4')).resolves.toEqual({
      sondou: true,
      legivel: true,
      audio: false,
      video: true,
    });
  });

  it('separa o arquivo ilegível do arquivo mudo', async () => {
    await expect(comRelatorio(ILEGIVEL).streamsDe('live.mp4')).resolves.toEqual({
      sondou: true,
      legivel: false,
      audio: false,
      video: false,
    });
  });

  it('reconhece o arquivo que só tem áudio', async () => {
    const soAudio = `
Input #0, ogg, from 'live.ogg':
  Duration: 00:58:10.02, start: 0.000000, bitrate: 24 kb/s
  Stream #0:0: Audio: opus, 48000 Hz, mono, fltp
`;
    await expect(comRelatorio(soAudio).streamsDe('live.ogg')).resolves.toEqual({
      sondou: true,
      legivel: true,
      audio: true,
      video: false,
    });
  });

  /*
   * A capa do MP3 é o caso que engana: o ffmpeg a reporta como stream de vídeo,
   * e um teste ingênuo deixaria passar um áudio disfarçado de gravação — que é
   * exatamente o que a recusa existe para pegar.
   */
  it('não confunde capa embutida com gravação de vídeo', async () => {
    const mp3ComCapa = `
Input #0, mp3, from 'live.mp3':
  Duration: 01:03:11.00, start: 0.025057, bitrate: 128 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 600x600 [SAR 1:1 DAR 1:1], 90k tbr (attached pic)
`;
    await expect(comRelatorio(mp3ComCapa).streamsDe('live.mp3')).resolves.toEqual({
      sondou: true,
      legivel: true,
      audio: true,
      video: false,
    });
  });

  /*
   * O stderr vazio é o processo morto (LVE, restart de deploy), não um arquivo
   * ruim — um arquivo ruim de verdade produz stderr com o motivo. É a diferença
   * entre "tente de novo" e "seu vídeo está corrompido" na tela do vendedor.
   */
  it('separa o ffmpeg que nem rodou do arquivo ilegível', async () => {
    await expect(comRelatorio('').streamsDe('live.mp4')).resolves.toEqual({
      sondou: false,
      legivel: false,
      audio: false,
      video: false,
    });
  });
});
