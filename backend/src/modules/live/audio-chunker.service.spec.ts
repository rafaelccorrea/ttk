import { FfmpegRunner } from '../../common/media/ffmpeg-runner';
import { AudioChunkerService } from './audio-chunker.service';

/**
 * O que este arquivo protege: a duração que sai daqui é gravada em
 * `live_sessions.duration_seconds`, que é `int`.
 *
 * O ffmpeg mede em fração de segundo, e uma live de 14 minutos volta como
 * `879.57`. Esse valor cru atravessava o pipeline inteiro — extração, Whisper,
 * a live toda transcrita — e só estourava no `UPDATE` final, com
 * `invalid input syntax for type integer: "879.57"`. O usuário via a live morrer
 * depois de esperar, e a transcrição paga ia junto.
 *
 * O dublê é o ffmpeg, e é o suficiente: não é preciso vídeo, nem áudio, nem
 * disco para provar que o número que sai daqui é inteiro.
 */
describe('AudioChunkerService', () => {
  function comDuracaoDe(segundos: number | null) {
    const ffmpeg = {
      enabled: true,
      streamsDe: async () => ({ legivel: true, video: true, audio: true }),
      comTmp: async <T>(_prefixo: string, fn: (pasta: string) => Promise<T>) =>
        fn('/tmp/pasta-falsa'),
      rodar: async () => undefined,
      duracao: async () => segundos,
    } as unknown as FfmpegRunner;

    return new AudioChunkerService(ffmpeg);
  }

  it('devolve a duração como inteiro, mesmo quando o ffmpeg mede em fração', async () => {
    const chunker = comDuracaoDe(879.57);

    const duracao = await chunker.comAudioExtraido(
      'live.mp4',
      'live.mp4',
      async (ctx) => ctx.durationSeconds,
    );

    expect(duracao).toBe(880);
    expect(Number.isInteger(duracao)).toBe(true);
  });

  it('arredonda para cima: o segundo quebrado é áudio que o Whisper transcreve', async () => {
    const chunker = comDuracaoDe(600.01);

    await expect(
      chunker.comAudioExtraido('live.mp4', 'live.mp4', async (c) => c.durationSeconds),
    ).resolves.toBe(601);
  });

  it('preserva o null de quem não conseguiu medir, em vez de virar zero', async () => {
    const chunker = comDuracaoDe(null);

    await expect(
      chunker.comAudioExtraido('live.mp4', 'live.mp4', async (c) => c.durationSeconds),
    ).resolves.toBeNull();
  });
});
