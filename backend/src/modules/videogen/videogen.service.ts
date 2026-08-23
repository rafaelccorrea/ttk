import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { ACTION_PRICES } from '../billing/billing.config';
import { AiCostService } from '../telemetry/ai-cost.service';
import { GenerateMediaDto } from './dto/generate-media.dto';
import { GeneratedMedia } from './entities/generated-media.entity';
import { MEDIA_ROUTE, MediaMirrorService } from '../media/media-mirror.service';
import { GERADOR_DE_MIDIA, type GeradorDeMidia, type OpcoesDeVideo } from './gerador-de-midia';

/** Opções de render vindas da campanha: modelo, fala e a voz de referência (URL). */
export interface OpcoesDeRender extends OpcoesDeVideo {
  vozReferenciaUrl?: string | null;
  /** Preço desta cena em créditos (ver `creditosDaCena`). Ausente = tabela. */
  creditos?: number;
}

const TERMINAL = ['completed', 'failed', 'nsfw', 'canceled'];

@Injectable()
export class VideogenService {
  constructor(
    @InjectRepository(GeneratedMedia)
    private readonly media: Repository<GeneratedMedia>,
    @Inject(GERADOR_DE_MIDIA)
    private readonly higgsfield: GeradorDeMidia,
    private readonly billing: BillingService,
    private readonly custos: AiCostService,
    private readonly config: ConfigService,
    private readonly mirror: MediaMirrorService,
  ) {}

  /**
   * Lê a voz de referência para mandar junto do job. URL nossa (bucket
   * privado) sai pelo S3; URL externa, por fetch. Falha vira "sem referência"
   * — a cena sai com voz sorteada, nunca sem cena.
   */
  private async lerAudio(url: string | null | undefined): Promise<Buffer | null> {
    if (!url) return null;
    try {
      const prefixo = `${MEDIA_ROUTE}/`;
      if (url.startsWith(prefixo)) {
        const objeto = await this.mirror.readObject(url.slice(prefixo.length));
        return objeto?.body ?? null;
      }
      const resposta = await fetch(url);
      return resposta.ok ? Buffer.from(await resposta.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  private async opcoesParaDriver(opcoes?: OpcoesDeRender): Promise<OpcoesDeVideo | undefined> {
    if (!opcoes) return undefined;
    const { vozReferenciaUrl, ...resto } = opcoes;
    return { ...resto, audioReferencia: await this.lerAudio(vozReferenciaUrl) };
  }

  /**
   * Custo unitário REAL de uma geração, para a telemetria de margem.
   *
   * Sem env configurado, entra o teto da tabela — o relatório fica no pior
   * caso, que é conservador mas honesto. Quando o operador conferir a fatura
   * da Higgsfield e setar VIDEOGEN_VIDEO_COST_BRL / VIDEOGEN_IMAGE_COST_BRL,
   * o relatório passa a mostrar a margem de verdade — e é ESSE número que
   * autoriza (ou não) baixar os 60 créditos da cena.
   */
  private custoUnitario(kind: 'image' | 'video'): number {
    const env = this.config.get<string>(
      kind === 'video' ? 'VIDEOGEN_VIDEO_COST_BRL' : 'VIDEOGEN_IMAGE_COST_BRL',
    );
    const valor = Number(env);
    if (env && Number.isFinite(valor) && valor > 0) return valor;
    return ACTION_PRICES[kind].worstCaseCostBrl;
  }

  private registrarCusto(userId: string, kind: 'image' | 'video', cobrado?: number): void {
    // Telemetria nunca no caminho crítico: registrar é fire-and-forget e o
    // próprio serviço engole o erro.
    void this.custos.registrarMidia(
      kind === 'video' ? 'videogen_video' : 'videogen_image',
      'higgsfield',
      this.custoUnitario(kind),
      {
        userId,
        chargedUnit: 'credit',
        chargedAmount: cobrado ?? ACTION_PRICES[kind].credits,
      },
    );
  }

  /**
   * O preço por modelo só vale onde o modelo é obedecido (CLI). No driver de
   * API toda cena é DoP e custa a tabela — a campanha pergunta aqui antes de
   * mostrar ou cobrar um número.
   */
  get precoPorModelo(): boolean {
    return this.higgsfield.escolheModelo;
  }

  /** Preço efetivo da cena: o pedido, se o driver escolhe modelo; senão a tabela. */
  private creditosDaGeracao(opcoes?: OpcoesDeRender): number {
    return this.precoPorModelo && opcoes?.creditos ? opcoes.creditos : ACTION_PRICES.video.credits;
  }

  /**
   * Inicia uma geração. Imagem: Soul direto. Vídeo: fase 1 (Soul cria o
   * frame base); a fase 2 (DoP anima) é disparada no refresh quando a
   * imagem fica pronta.
   */
  async generate(userId: string, dto: GenerateMediaDto): Promise<GeneratedMedia> {
    // Cobra antes de submeter; se a Higgsfield recusar, o estorno é automático.
    const submitted = await this.billing.withCharge(userId, dto.kind, () =>
      this.higgsfield.submitImage(dto.prompt, dto.aspectRatio ?? '9:16'),
    );
    this.registrarCusto(userId, dto.kind);
    return this.media.save(
      this.media.create({
        userId,
        kind: dto.kind,
        prompt: dto.prompt,
        aspectRatio: dto.aspectRatio ?? '9:16',
        status: (submitted.status as GeneratedMedia['status']) ?? 'queued',
        phase: 'image',
        requestId: submitted.requestId,
      }),
    );
  }

  /**
   * Anima uma imagem que JÁ existe, pulando a fase 1.
   *
   * É o que dá consistência de personagem às campanhas: o retrato-semente da
   * persona é gerado uma vez e entra como frame base de todas as cenas. Se
   * cada cena passasse pelo Soul de novo, a API devolveria uma pessoa
   * *parecida* a cada chamada — e o rosto trocaria no meio do anúncio.
   *
   * Cobra como vídeo, porque é exatamente o mesmo custo de DoP; o que se
   * economiza é a chamada de imagem, não a de vídeo.
   */
  /**
   * Compõe o frame com imagens REAIS de referência e depois anima.
   *
   * É o caminho da cena "apresentadora com o produto na mão": o frame nasce
   * do editor de imagem com o retrato E a foto do produto como referência —
   * réplica exata, não um objeto inventado — e o refresh dispara a animação
   * quando o frame fica pronto (mesmo encadeamento de fases do `generate`).
   *
   * Cobra como vídeo (60cr). O custo real soma a imagem de composição
   * (~R$ 0,60) ao vídeo (~R$ 3,60): R$ 4,20 contra R$ 6,00 de face — margem
   * 1,43×, ainda acima do piso de 1,4. É a cena mais cara do catálogo, e uma
   * por campanha.
   */
  async generateComposedVideo(
    userId: string,
    pedido: {
      framePrompt: string;
      referencias: Buffer[];
      videoPrompt: string;
      opcoes?: OpcoesDeRender;
    },
  ): Promise<GeneratedMedia> {
    const creditos = this.creditosDaGeracao(pedido.opcoes);
    const submitted = await this.billing.withCharge(
      userId,
      'video',
      () => this.higgsfield.submitImage(pedido.framePrompt, '9:16', pedido.referencias),
      1,
      creditos,
    );
    this.registrarCusto(userId, 'image', 0);
    this.registrarCusto(userId, 'video', creditos);
    return this.media.save(
      this.media.create({
        userId,
        kind: 'video',
        // O prompt guardado é o DO VÍDEO: é ele que a fase 2 usa ao animar.
        prompt: pedido.videoPrompt,
        aspectRatio: '9:16',
        status: (submitted.status as GeneratedMedia['status']) ?? 'queued',
        phase: 'image',
        requestId: submitted.requestId,
        // Gravados já na fase 1: a fase 2 (refresh) anima com ESTE modelo e
        // ESTA voz — o request de origem já terminou quando ela dispara.
        model: pedido.opcoes?.modelo ?? null,
        voiceRefUrl: pedido.opcoes?.vozReferenciaUrl ?? null,
        chargedCredits: creditos,
      }),
    );
  }

  async generateFromImage(
    userId: string,
    imageUrl: string,
    prompt: string,
    imagem?: Buffer,
    opcoes?: OpcoesDeRender,
  ): Promise<GeneratedMedia> {
    const paraDriver = await this.opcoesParaDriver(opcoes);
    const creditos = this.creditosDaGeracao(opcoes);
    const submitted = await this.billing.withCharge(
      userId,
      'video',
      () => this.higgsfield.submitVideo(imageUrl, prompt, imagem, paraDriver),
      1,
      creditos,
    );
    this.registrarCusto(userId, 'video', creditos);
    return this.media.save(
      this.media.create({
        userId,
        kind: 'video',
        prompt,
        aspectRatio: '9:16',
        status: (submitted.status as GeneratedMedia['status']) ?? 'queued',
        // Já nasce na fase 2: o refresh vai direto para o desfecho.
        phase: 'video',
        imageUrl,
        requestId: submitted.requestId,
        model: opcoes?.modelo ?? null,
        voiceRefUrl: opcoes?.vozReferenciaUrl ?? null,
        chargedCredits: creditos,
      }),
    );
  }

  /** Modelo que gerou cada mídia, por id — para a tela mostrar "IA: X". */
  async modelosDasMidias(ids: string[]): Promise<Record<string, string | null>> {
    if (!ids.length) return {};
    const itens = await this.media.find({
      where: { id: In(ids) },
      select: { id: true, model: true },
    });
    return Object.fromEntries(itens.map((m) => [m.id, m.model ?? null]));
  }

  list(userId: string): Promise<GeneratedMedia[]> {
    return this.media.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /** Busca o item e, se ainda estiver em andamento, atualiza pelo status da API. */
  async refresh(userId: string, id: string): Promise<GeneratedMedia> {
    const item = await this.media.findOneBy({ id, userId });
    if (!item) {
      throw new NotFoundException(`Geração ${id} não encontrada`);
    }
    if (TERMINAL.includes(item.status) || !item.requestId) {
      return item;
    }

    const status = await this.higgsfield.getStatus(item.requestId);

    if (status.status === 'completed') {
      if (item.phase === 'image') {
        item.imageUrl = status.imageUrl ?? item.imageUrl;
        if (item.kind === 'image') {
          item.status = 'completed';
          item.outputUrl = status.imageUrl ?? null as unknown as string;
        } else if (item.imageUrl) {
          /*
           * Vídeo: frame pronto → dispara a animação (fase 2).
           *
           * O try/catch não é zelo: sem ele, uma falha aqui subia antes do
           * `save` do fim do método, e o item ficava eternamente em
           * `phase: 'image'` com o request da imagem já `completed`. Cada
           * refresh seguinte — e o front faz polling — re-submetia um DoP novo,
           * o item mais caro da tabela, sem cobrar um crédito a mais. Falhar
           * leva o item para um estado terminal, que estorna logo abaixo e
           * encerra o ciclo.
           */
          try {
            const video = await this.higgsfield.submitVideo(
              item.imageUrl,
              item.prompt,
              undefined,
              await this.opcoesParaDriver({ modelo: item.model, vozReferenciaUrl: item.voiceRefUrl }),
            );
            item.phase = 'video';
            item.requestId = video.requestId;
            item.status = (video.status as GeneratedMedia['status']) ?? 'queued';
          } catch (error) {
            item.status = 'failed';
            item.error = `Falha ao animar a imagem: ${(error as Error).message}`;
          }
        } else {
          item.status = 'failed';
          item.error = 'Imagem base não retornou URL.';
        }
      } else {
        item.status = 'completed';
        item.outputUrl = status.videoUrl ?? null as unknown as string;
      }
    } else if (TERMINAL.includes(status.status)) {
      item.status = status.status as GeneratedMedia['status'];
      item.error = status.error ?? item.error;
    } else {
      item.status = status.status as GeneratedMedia['status'];
    }

    /*
     * Falhou depois de cobrado → devolve os créditos, UMA vez só.
     *
     * A marca do estorno é gravada por um UPDATE condicional, não pelo
     * `item.refunded` em memória: o front faz polling e as campanhas chamam
     * este mesmo refresh, então dois pedidos simultâneos liam `refunded:
     * false` os dois e estornavam 60 créditos em dobro. Quem devolve é só
     * quem conseguiu virar o flag (`affected === 1`) — o outro perde a corrida
     * no banco e não paga nada.
     */
    if (['failed', 'nsfw', 'canceled'].includes(item.status) && !item.refunded) {
      const marcou = await this.media.update(
        { id: item.id, refunded: false },
        { refunded: true },
      );
      // Em memória o flag sobe nos dois casos: quem perdeu a corrida também
      // precisa refletir o estorno, senão o `save` do fim do método zeraria a
      // marca gravada pelo vencedor e um terceiro refresh estornaria de novo.
      item.refunded = true;
      if (marcou.affected) {
        // Devolve o que FOI cobrado — a cena falada custa mais que a tabela.
        await this.billing.refund(
          userId,
          item.kind,
          `Estorno: geração de ${item.kind === 'video' ? 'vídeo' : 'imagem'} falhou`,
          1,
          item.chargedCredits ?? undefined,
        );
      }
    }

    return this.media.save(item);
  }

  async delete(userId: string, id: string): Promise<void> {
    const result = await this.media.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(`Geração ${id} não encontrada`);
    }
  }

  /**
   * Limpeza em lote, para quando o DONO do vídeo morre (campanha apagada,
   * persona apagada, roteiro regerado): sem isto as gerações ficam órfãs em
   * "Minhas Gerações", apontando para URLs da Higgsfield que expiram — o
   * vendedor via um card de um vídeo que já não existe em lugar nenhum.
   *
   * Silenciosa de propósito, ao contrário do `delete`: quem chama está no meio
   * de uma exclusão maior, e um id que já não existe não é erro — é o estado
   * que se queria alcançar.
   */
  async deleteMany(userId: string, ids: Array<string | null>): Promise<void> {
    const validos = ids.filter((id): id is string => !!id);
    if (!validos.length) return;
    await this.media.delete(validos.map((id) => ({ id, userId })));
  }
}
