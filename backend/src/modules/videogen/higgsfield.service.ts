import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE_URL = 'https://platform.higgsfield.ai';

export interface SubmitResult {
  requestId: string;
  status: string;
}

export interface StatusResult {
  status: string;
  imageUrl?: string;
  videoUrl?: string;
  error?: string;
}

/** Cliente da API da Higgsfield (Soul texto→imagem, DoP imagem→vídeo). */
@Injectable()
export class HiggsfieldService {
  private readonly logger = new Logger(HiggsfieldService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(
      this.config.get('HIGGSFIELD_API_KEY') &&
        this.config.get('HIGGSFIELD_API_SECRET'),
    );
  }

  private authHeader(): string {
    const key = this.config.get<string>('HIGGSFIELD_API_KEY');
    const secret = this.config.get<string>('HIGGSFIELD_API_SECRET');
    return `Key ${key}:${secret}`;
  }

  private async request(path: string, init?: RequestInit): Promise<any> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Geração de mídia indisponível: HIGGSFIELD_API_KEY não configurada.',
      );
    }
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = String(body?.detail ?? response.statusText);
      this.logger.warn(`Higgsfield ${path} → ${response.status}: ${detail}`);
      if (detail.includes('not_enough_credits')) {
        throw new HttpException(
          'Créditos insuficientes na Higgsfield — adicione créditos em cloud.higgsfield.ai e tente de novo.',
          402,
        );
      }
      throw new BadGatewayException(`Falha na Higgsfield: ${detail}`);
    }
    return body;
  }

  /** Soul: texto → imagem (frame base ou imagem final). */
  async submitImage(prompt: string, aspectRatio: string): Promise<SubmitResult> {
    const body = await this.request('/higgsfield-ai/soul/standard', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        aspect_ratio: aspectRatio,
        resolution: '720p',
      }),
    });
    return { requestId: body.request_id, status: body.status };
  }

  /** DoP: imagem → vídeo animado. */
  async submitVideo(imageUrl: string, prompt: string): Promise<SubmitResult> {
    const body = await this.request('/higgsfield-ai/dop/standard', {
      method: 'POST',
      body: JSON.stringify({ image_url: imageUrl, prompt }),
    });
    return { requestId: body.request_id, status: body.status };
  }

  async getStatus(requestId: string): Promise<StatusResult> {
    const body = await this.request(`/requests/${requestId}/status`);
    return {
      status: body.status,
      imageUrl: body?.images?.[0]?.url,
      videoUrl: body?.video?.url,
      error: body?.error ? String(body.error) : undefined,
    };
  }
}
