import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCostService } from '../telemetry/ai-cost.service';

/** Trecho de fala com marcação de tempo, já reduzido ao que interessa. */
export type WhisperSegment = { start: number; end: number; text: string };
export type WhisperWord = { start: number; end: number; word: string };

/** Transcrição de áudio/vídeo via OpenAI Whisper. */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly custos: AiCostService,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get('OPENAI_API_KEY'));
  }

  async transcribe(
    file: Express.Multer.File,
  ): Promise<{ transcript: string }> {
    const { transcript } = await this.transcribeBuffer(
      file.buffer,
      file.originalname || 'video.mp4',
      { mimetype: file.mimetype },
    );
    return { transcript };
  }

  async transcribeBuffer(
    buffer: Buffer,
    filename: string,
    opts: {
      mimetype?: string;
      verboseTimestamps?: boolean;
      /** Também devolver `words` (tempo por palavra). Só com `verboseTimestamps`. */
      wordTimestamps?: boolean;
      prompt?: string;
      /** Duração conhecida, para medir o custo quando não há timestamps. */
      durationSeconds?: number;
      /** Dono da chamada, só para o relatório de custo. */
      userId?: string | null;
    } = {},
  ): Promise<{ transcript: string; segments?: WhisperSegment[]; words?: WhisperWord[] }> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Transcrição indisponível: OPENAI_API_KEY não configurada.',
      );
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], {
        type: opts.mimetype || 'application/octet-stream',
      }),
      filename,
    );
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    if (opts.verboseTimestamps) {
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      // Palavras com tempo custam o mesmo e são o que a legenda karaokê usa.
      if (opts.wordTimestamps) form.append('timestamp_granularities[]', 'word');
    } else {
      form.append('response_format', 'json');
    }

    // O prompt aqui não é instrução de comportamento: o Whisper usa esse texto como
    // contexto léxico da fatia. Numa live de vendas de 3h, que precisa ser fatiada em
    // blocos, passar o final da transcrição do bloco anterior é justamente o que segura
    // a grafia do nome do produto entre as fatias. Sem isso o mesmo produto sai
    // "Kit Glow", "Kit Glou" e "Kitglow" em blocos diferentes — e a extração posterior,
    // que agrupa por nome, acaba criando três produtos distintos para o mesmo item.
    if (opts.prompt) {
      form.append('prompt', opts.prompt);
    }

    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get('OPENAI_API_KEY')}`,
        },
        body: form,
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body?.error?.message ?? response.statusText;
      this.logger.warn(`Whisper falhou (${response.status}): ${detail}`);
      throw new BadGatewayException(`Falha na transcrição: ${detail}`);
    }
    const segments: WhisperSegment[] | undefined = opts.verboseTimestamps
      ? (body?.segments ?? []).map((s: any) => ({
          start: Number(s.start ?? 0),
          end: Number(s.end ?? 0),
          text: String(s.text ?? '').trim(),
        }))
      : undefined;
    const words: WhisperWord[] | undefined =
      opts.verboseTimestamps && opts.wordTimestamps && Array.isArray(body?.words)
        ? body.words.map((w: any) => ({
            start: Number(w.start ?? 0),
            end: Number(w.end ?? 0),
            word: String(w.word ?? '').trim(),
          }))
        : undefined;

    /*
     * O Whisper cobra por minuto de áudio, então a medição não sai de `usage`:
     * sai da duração. Quando o formato verboso foi pedido, o fim do último
     * segmento é a duração real do que ele processou — melhor do que o que
     * dissemos que era o arquivo, porque é o número pelo qual seremos cobrados.
     * Sem os timestamps, `durationSeconds` cobre; sem os dois, não se inventa
     * um custo: a linha simplesmente não é registrada.
     */
    const duracao =
      segments?.length
        ? segments[segments.length - 1].end
        : (opts.durationSeconds ?? 0);
    if (duracao > 0) {
      void this.custos.registrarTranscricao(duracao, {
        userId: opts.userId ?? null,
      });
    }

    return { transcript: String(body.text ?? '').trim(), segments, words };
  }
}
