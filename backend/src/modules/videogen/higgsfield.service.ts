import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GeradorDeMidia,
  OpcoesDeVideo,
  StatusResult,
  SubmitResult,
} from './gerador-de-midia';

const BASE_URL = 'https://platform.higgsfield.ai';

/** Cliente da API da Higgsfield (Soul texto→imagem, DoP imagem→vídeo). */
@Injectable()
export class HiggsfieldService implements GeradorDeMidia {
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
        /*
         * Quem está sem crédito somos NÓS, não quem pediu a geração.
         *
         * A mensagem antiga dizia "adicione créditos em cloud.higgsfield.ai" e
         * ia inteira para a tela do cliente — que não tem conta na Higgsfield,
         * não pode adicionar crédito nenhum e acabava de descobrir o nome do
         * nosso fornecedor por causa de uma fatura nossa. Instrução impossível
         * de cumprir lê como erro do próprio usuário e vira ticket de suporte.
         *
         * O cliente precisa saber duas coisas, e só elas: que não foi culpa
         * dele e que não pagou por isso — o estorno é real, `withCharge` devolve
         * o crédito quando esta exceção sobe. O que fazer a respeito é recado
         * para o operador, e por isso vai no log em nível de erro, com o
         * endereço da carteira que realmente existe hoje.
         */
        this.logger.error(
          'Higgsfield sem créditos: geração recusada. Recarregue em ' +
            'higgsfield.ai/me/settings (botão Top-up). Atenção: o saldo do site ' +
            'pode não ser o mesmo da API — confirme com o suporte antes de comprar.',
        );
        throw new HttpException(
          'A geração de mídia está temporariamente indisponível. Seus créditos ' +
            'não foram cobrados — tente de novo em alguns minutos.',
          503,
        );
      }
      throw new BadGatewayException(`Falha na Higgsfield: ${detail}`);
    }
    return body;
  }

  /** Soul: texto → imagem (frame base ou imagem final). */
  async submitImage(
    prompt: string,
    aspectRatio: string,
    referencias?: Buffer[],
  ): Promise<SubmitResult> {
    if (referencias?.length) {
      throw new ServiceUnavailableException(
        'Composição com imagens de referência exige o driver de CLI da Higgsfield.',
      );
    }
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
  async submitVideo(
    imageUrl: string,
    prompt: string,
    imagem?: Buffer,
    // A API de plataforma só tem o DoP: o modelo não é escolhível aqui.
    _opcoes?: OpcoesDeVideo,
  ): Promise<SubmitResult> {
    // A API só aceita URL pública. Se o frame veio como buffer é porque a URL
    // espelhada é relativa — a correção é configurar AWS_S3_PUBLIC_BASE, e a
    // mensagem tem que dizer isso em vez de deixar um TypeError subir.
    if (imagem?.length && !/^https?:\/\//i.test(imageUrl)) {
      throw new ServiceUnavailableException(
        'O driver de API da Higgsfield precisa de URL pública para o frame base. ' +
          'Configure AWS_S3_PUBLIC_BASE ou use o driver de CLI.',
      );
    }
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
