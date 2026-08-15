import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Transcrição de áudio/vídeo via OpenAI Whisper. */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get('OPENAI_API_KEY'));
  }

  async transcribe(
    file: Express.Multer.File,
  ): Promise<{ transcript: string }> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Transcrição indisponível: OPENAI_API_KEY não configurada.',
      );
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname || 'video.mp4',
    );
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    form.append('response_format', 'json');

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
    return { transcript: String(body.text ?? '').trim() };
  }
}
