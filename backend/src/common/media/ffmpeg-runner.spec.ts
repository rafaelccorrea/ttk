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

  it('reconhece a gravação com trilha de áudio', async () => {
    await expect(comRelatorio(COM_AUDIO).streamsDe('live.mp4')).resolves.toEqual({
      legivel: true,
      audio: true,
    });
  });

  it('reconhece a gravação muda — tem vídeo, não tem som', async () => {
    await expect(comRelatorio(SEM_AUDIO).streamsDe('live.mp4')).resolves.toEqual({
      legivel: true,
      audio: false,
    });
  });

  it('separa o arquivo ilegível do arquivo mudo', async () => {
    await expect(comRelatorio(ILEGIVEL).streamsDe('live.mp4')).resolves.toEqual({
      legivel: false,
      audio: false,
    });
  });

  /*
   * O caso que motivou tudo isto: o pipeline extrai com `-vn`, então um arquivo
   * SÓ de áudio é entrada perfeitamente válida. Uma leitura que exigisse stream
   * de vídeo recusaria a gravação boa.
   */
  it('aceita o arquivo que só tem áudio', async () => {
    const soAudio = `
Input #0, ogg, from 'live.ogg':
  Duration: 00:58:10.02, start: 0.000000, bitrate: 24 kb/s
  Stream #0:0: Audio: opus, 48000 Hz, mono, fltp
`;
    await expect(comRelatorio(soAudio).streamsDe('live.ogg')).resolves.toEqual({
      legivel: true,
      audio: true,
    });
  });
});
