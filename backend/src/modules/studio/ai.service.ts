import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ScriptRequest {
  type: 'live' | 'video';
  productName: string;
  productDescription?: string;
  price?: number;
  tone?: string;
}

export interface ScriptResult {
  content: string;
  model: string;
}

const LIVE_SYSTEM = `Você é um roteirista especialista em lives de vendas no TikTok Shop Brasil.
Escreva roteiros de live em CICLOS repetíveis de ~90 segundos no formato:
APRESENTAÇÃO (mostra o produto e o problema que resolve) → OFERTA (preço, condição, escassez) → GARANTIA (segurança da compra, frete, devolução) → CTA (comando claro para tocar no carrinho).
O espectador médio fica ~20 segundos na live, então cada ciclo precisa funcionar isolado.
Gere 2 ciclos completos com falas prontas para ler, em português do Brasil, linguagem falada e direta.
Termine com 3 respostas prontas para perguntas comuns do chat.`;

const VIDEO_SYSTEM = `Você é um roteirista especialista em vídeos curtos que vendem no TikTok Shop Brasil.
Escreva um roteiro no formato GANCHO (0-3s, para o scroll) → CORPO (demonstração, prova, benefício) → CTA (comando claro).
Inclua indicação de cena para cada fala (o que aparece na tela).
Gere 3 variações de gancho no final. Português do Brasil, linguagem falada.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async generateScript(request: ScriptRequest): Promise<ScriptResult> {
    if (!this.client) {
      return this.templateFallback(request);
    }
    try {
      const response = await this.client.messages.create({
        model: 'claude-opus-5',
        max_tokens: 16000,
        system: request.type === 'live' ? LIVE_SYSTEM : VIDEO_SYSTEM,
        messages: [
          {
            role: 'user',
            content: this.buildUserPrompt(request),
          },
        ],
      });
      if (response.stop_reason === 'refusal') {
        this.logger.warn('Geração recusada pelo modelo; usando template.');
        return this.templateFallback(request);
      }
      const content = response.content
        .filter((b) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
      return { content, model: response.model };
    } catch (error) {
      this.logger.error(`Falha na API de IA: ${error}. Usando template.`);
      return this.templateFallback(request);
    }
  }

  private buildUserPrompt(r: ScriptRequest): string {
    const parts = [`Produto: ${r.productName}`];
    if (r.price) parts.push(`Preço: R$ ${r.price.toFixed(2)}`);
    if (r.productDescription) parts.push(`Detalhes: ${r.productDescription}`);
    if (r.tone) parts.push(`Tom desejado: ${r.tone}`);
    parts.push(
      r.type === 'live'
        ? 'Gere o roteiro de live agora.'
        : 'Gere o roteiro de vídeo curto agora.',
    );
    return parts.join('\n');
  }

  // Sem ANTHROPIC_API_KEY, gera um roteiro estrutural preenchido com o produto.
  private templateFallback(r: ScriptRequest): ScriptResult {
    const name = r.productName;
    const price = r.price ? `R$ ${r.price.toFixed(2)}` : 'preço promocional';
    const content =
      r.type === 'live'
        ? [
            `# Roteiro de Live — ${name}`,
            ``,
            `## Ciclo 1`,
            `**Apresentação:** "Olha só quem chegou na live: ${name}. Se você sofre com [problema], presta atenção nos próximos segundos."`,
            `**Oferta:** "Aqui na live tá saindo por ${price} — só enquanto durar o estoque do carrinho."`,
            `**Garantia:** "Compra 100% protegida pelo TikTok Shop: se não gostar, devolve sem burocracia."`,
            `**CTA:** "Toca no carrinho laranja AGORA e garante o seu antes de acabar."`,
            ``,
            `## Ciclo 2`,
            `**Apresentação:** "Pra quem acabou de chegar: esse é o ${name}, o queridinho da live de hoje."`,
            `**Oferta:** "Preço de live: ${price}. Fora daqui você não encontra."`,
            `**Garantia:** "Envio rápido e rastreado, com garantia da plataforma."`,
            `**CTA:** "Clica no carrinho, escolhe a variação e finaliza — leva menos de 1 minuto."`,
            ``,
            `## Respostas rápidas pro chat`,
            `- "Chega em quanto tempo?" → "Envio em até 24h úteis, com código de rastreio."`,
            `- "Tem garantia?" → "Tem! Compra protegida pelo TikTok Shop, devolução grátis."`,
            `- "Serve pra mim?" → "Tem tabela de medidas no carrinho, dá uma olhada e me pergunta aqui."`,
          ].join('\n')
        : [
            `# Roteiro de Vídeo — ${name}`,
            ``,
            `**GANCHO (0-3s)** [close no produto] "Eu testei o ${name} por 7 dias e NINGUÉM te conta isso..."`,
            `**CORPO (3-20s)** [demonstração de uso] "Olha o antes e depois. ${r.productDescription ?? 'Mostra o principal benefício na prática.'}"`,
            `**CORPO (20-30s)** [prova social] "Já são milhares vendidos só esse mês, e tá por ${price}."`,
            `**CTA (30-35s)** [aponta pro carrinho] "Toca no carrinho laranja aqui embaixo antes que volte pro preço normal."`,
            ``,
            `## Variações de gancho`,
            `1. "Se você ainda não conhece o ${name}, você tá perdendo dinheiro."`,
            `2. "O achadinho que a internet tentou esconder de você:"`,
            `3. "POV: você descobriu o ${name} antes de viralizar."`,
          ].join('\n');
    return { content, model: 'template-local' };
  }
}
