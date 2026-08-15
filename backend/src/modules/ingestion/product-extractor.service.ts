import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ExtractedProduct {
  /** Nome do produto anunciado, como um cliente o chamaria. */
  name: string;
  category: string;
  /** 0 a 1 — abaixo de 0.6 descartamos. */
  confidence: number;
  priceBrl: number | null;
}

/**
 * Descobre QUAL PRODUTO um anúncio brasileiro está vendendo.
 *
 * Por que existe: o TikTok não expõe catálogo de produto em lugar público
 * (ranking removido, loja atrás de captcha, afiliado exige aprovação). Mas
 * temos os vídeos de anúncio BR do Top Ads — e o anúncio DIZ o que vende.
 * Então transcrevemos o áudio (Whisper) e extraímos o produto da fala + da
 * legenda. É dado derivado de anúncio real, não número inventado.
 */
@Injectable()
export class ProductExtractorService {
  private readonly logger = new Logger(ProductExtractorService.name);
  private readonly openaiKey: string;

  constructor(config: ConfigService) {
    this.openaiKey = config.get<string>('OPENAI_API_KEY') ?? '';
  }

  get enabled(): boolean {
    return this.openaiKey.length > 0;
  }

  /** Baixa o MP4 e transcreve com Whisper. Retorna '' se falhar. */
  async transcribe(videoUrl: string): Promise<string> {
    try {
      const response = await fetch(videoUrl);
      if (!response.ok) return '';
      const buffer = Buffer.from(await response.arrayBuffer());
      // Whisper aceita até 25MB; anúncio curto fica muito abaixo disso.
      if (buffer.length > 24 * 1024 * 1024) return '';

      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buffer)]), 'ad.mp4');
      form.append('model', 'whisper-1');
      form.append('language', 'pt');

      const whisper = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${this.openaiKey}` },
          body: form,
        },
      );
      if (!whisper.ok) {
        this.logger.warn(`Whisper falhou: ${whisper.status}`);
        return '';
      }
      const body = (await whisper.json()) as { text?: string };
      return (body.text ?? '').trim();
    } catch (error) {
      this.logger.warn(`Transcrição falhou: ${error}`);
      return '';
    }
  }

  /**
   * Extrai o produto a partir da fala + legenda + marca.
   * Retorna null quando o anúncio não vende um produto físico identificável
   * (serviço, app, institucional) — melhor nada do que produto inventado.
   */
  async extract(input: {
    caption: string;
    brand: string | null;
    transcript: string;
  }): Promise<ExtractedProduct | null> {
    if (!this.enabled) return null;

    const prompt = `Você recebe um anúncio brasileiro do TikTok. Identifique o PRODUTO FÍSICO anunciado.

LEGENDA: """${input.caption}"""
MARCA: ${input.brand ?? 'desconhecida'}
FALA DO VÍDEO: """${input.transcript.slice(0, 2000)}"""

Responda APENAS um JSON, sem texto ao redor:
{"name": "nome comercial curto do produto (máx. 8 palavras, como aparece numa loja)", "category": "categoria em português (ex.: beleza, casa, moda, eletronicos, infantil, pet, fitness)", "confidence": 0.0 a 1.0, "priceBrl": número ou null se não citado}

REGRAS:
- Se for serviço, aplicativo, curso, evento, banco, seguro ou anúncio institucional (sem produto físico), responda {"name": null, "confidence": 0}
- name deve ser o PRODUTO, nunca a frase de propaganda
- confidence baixa se você estiver adivinhando`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.openaiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          response_format: { type: 'json_object' },
          max_tokens: 200,
        }),
      });
      if (!response.ok) {
        this.logger.warn(`Extração falhou: ${response.status}`);
        return null;
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = body.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as Partial<ExtractedProduct> & {
        name?: string | null;
      };

      if (!parsed.name || typeof parsed.name !== 'string') return null;
      const confidence = Number(parsed.confidence ?? 0);
      if (confidence < 0.6) return null;

      return {
        name: parsed.name.replace(/\s+/g, ' ').trim().slice(0, 120),
        category: (parsed.category ?? 'geral').toLowerCase().trim(),
        confidence,
        priceBrl:
          typeof parsed.priceBrl === 'number' && parsed.priceBrl > 0
            ? parsed.priceBrl
            : null,
      };
    } catch (error) {
      this.logger.warn(`Extração falhou: ${error}`);
      return null;
    }
  }
}
