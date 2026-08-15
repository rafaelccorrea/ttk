import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { BillingService } from '../billing/billing.service';
import { ACTION_PRICES } from '../billing/billing.config';
import { MEDIA_ROUTE, MediaMirrorService } from '../media/media-mirror.service';
import { Product } from '../products/entities/product.entity';
import { AiService } from '../studio/ai.service';
import { Video } from '../videos/entities/video.entity';
import { VideogenService } from '../videogen/videogen.service';
import {
  CreateCampaignDto,
  CreatePersonaDto,
  CreateUserProductDto,
  UpdateSceneDto,
} from './dto/campaigns.dto';
import { Campaign } from './entities/campaign.entity';
import { CampaignScene } from './entities/campaign-scene.entity';
import { Persona } from './entities/persona.entity';
import { UserProduct } from './entities/user-product.entity';
import { VideoAssemblyService } from './video-assembly.service';
import {
  PERSONA_GROUPS,
  montarFragmento,
  rotularPersona,
  validarAtributos,
} from './persona-catalog';

/** Cada geração de vídeo rende ~5s; a duração escolhida define o nº de cenas. */
const SEGUNDOS_POR_CENA = 5;

/** Quantos ganchos da categoria entram como referência no roteiro. */
const MAX_REFERENCIAS = 8;

/** Teto de fotos por produto — mais que isso ninguém usa no storyboard. */
const MAX_FOTOS = 5;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(UserProduct)
    private readonly produtos: Repository<UserProduct>,
    @InjectRepository(Persona)
    private readonly personas: Repository<Persona>,
    @InjectRepository(Campaign)
    private readonly campanhas: Repository<Campaign>,
    @InjectRepository(CampaignScene)
    private readonly cenas: Repository<CampaignScene>,
    @InjectRepository(Product)
    private readonly catalogo: Repository<Product>,
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly ai: AiService,
    private readonly videogen: VideogenService,
    private readonly mirror: MediaMirrorService,
    private readonly billing: BillingService,
    private readonly assembly: VideoAssemblyService,
  ) {}

  // ------------------------------------------------------------------ preços
  /** Tabela que a tela mostra antes de qualquer clique que cobra. */
  precos(durationSeconds = 15) {
    const cenas = this.cenasPara(durationSeconds);
    return {
      persona: ACTION_PRICES.image.credits,
      roteiro: ACTION_PRICES.script.credits,
      cena: ACTION_PRICES.video.credits,
      cenas,
      // O que o vendedor gasta do zero até o vídeo pronto, sem reuso.
      totalCampanha:
        ACTION_PRICES.script.credits + ACTION_PRICES.video.credits * cenas,
    };
  }

  private cenasPara(durationSeconds: number): number {
    return Math.max(1, Math.round(durationSeconds / SEGUNDOS_POR_CENA));
  }

  // ---------------------------------------------------------------- produtos
  async criarProduto(userId: string, dto: CreateUserProductDto): Promise<UserProduct> {
    let { name, priceBrl, benefit, problemSolved } = dto;

    // Importado do catálogo: os campos vêm preenchidos e o vendedor ajusta.
    if (dto.sourceProductId) {
      const origem = await this.catalogo.findOneBy({ id: dto.sourceProductId });
      if (!origem) {
        throw new NotFoundException('Produto do catálogo não encontrado.');
      }
      name = name || origem.title;
      priceBrl = priceBrl ?? Number(origem.price);
    }

    // As fotos são espelhadas antes de salvar: URL de terceiro expira, e um
    // produto sem foto não vira B-roll de cena nenhuma.
    const images = await this.espelharFotos(dto.images ?? []);

    return this.produtos.save(
      this.produtos.create({
        userId,
        name,
        priceBrl: priceBrl ?? null,
        benefit: benefit ?? null,
        problemSolved: problemSolved ?? null,
        images,
        sourceProductId: dto.sourceProductId ?? null,
      }),
    );
  }

  /**
   * Só aceita o que o espelhamento conseguiu decodificar como imagem. Guardar
   * a URL crua abriria dois buracos de uma vez: ela expira, e o servidor
   * passaria a buscar um endereço escolhido pelo cliente.
   */
  private async espelharFotos(urls: string[]): Promise<string[]> {
    const saida: string[] = [];
    for (const url of urls.slice(0, 5)) {
      if (!/^https:\/\//i.test(url)) continue;
      const espelhada = await this.mirror.mirror(url, 'user-products', randomUUID());
      if (espelhada) saida.push(espelhada);
    }
    return saida;
  }

  /**
   * Anexa uma foto enviada pelo vendedor.
   *
   * A foto não é enfeite de cadastro: ela vira o frame base das cenas de
   * demonstração. Sem ela, a IA inventa um objeto parecido e o anúncio mostra
   * um produto que não é o que ele vende.
   */
  async adicionarFoto(
    userId: string,
    productId: string,
    arquivo: Buffer,
  ): Promise<UserProduct> {
    const produto = await this.produtos.findOneBy({ id: productId, userId });
    if (!produto) throw new NotFoundException('Produto não encontrado.');
    if (produto.images.length >= MAX_FOTOS) {
      throw new ConflictException(`Máximo de ${MAX_FOTOS} fotos por produto.`);
    }

    const url = await this.mirror.putImage(arquivo, 'user-products', produto.id);
    if (!url) {
      throw new BadRequestException(
        'Não foi possível ler a imagem. Envie um JPG, PNG ou WebP.',
      );
    }
    // A mesma foto enviada de novo devolve a mesma chave; não duplica.
    if (!produto.images.includes(url)) produto.images = [...produto.images, url];
    return this.produtos.save(produto);
  }

  async removerFoto(
    userId: string,
    productId: string,
    url: string,
  ): Promise<UserProduct> {
    const produto = await this.produtos.findOneBy({ id: productId, userId });
    if (!produto) throw new NotFoundException('Produto não encontrado.');
    produto.images = produto.images.filter((foto) => foto !== url);
    return this.produtos.save(produto);
  }

  listarProdutos(userId: string): Promise<UserProduct[]> {
    return this.produtos.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async removerProduto(userId: string, id: string): Promise<void> {
    const r = await this.produtos.delete({ id, userId });
    if (!r.affected) throw new NotFoundException('Produto não encontrado.');
  }

  // ---------------------------------------------------------------- personas
  /** Catálogo de atributos para a tela montar os seletores. */
  opcoesDePersona() {
    return PERSONA_GROUPS;
  }

  /**
   * Cria a persona e dispara o retrato-semente. Cobra como imagem, uma única
   * vez — a persona é reusada em quantas campanhas o vendedor quiser.
   */
  async criarPersona(userId: string, dto: CreatePersonaDto): Promise<Persona> {
    let attrs;
    try {
      attrs = validarAtributos(dto.attrs as never);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const promptFragment = montarFragmento(attrs);
    const retrato = `portrait of ${promptFragment}, looking at camera, waist up`;

    // A cobrança acontece aqui dentro, com estorno automático se a API recusar.
    const media = await this.videogen.generate(userId, {
      kind: 'image',
      prompt: retrato,
      aspectRatio: '9:16',
    });

    return this.personas.save(
      this.personas.create({
        userId,
        label: dto.label?.trim() || rotularPersona(attrs),
        attrs,
        promptFragment,
        status: 'gerando',
        seedMediaId: media.id,
        seedImageUrl: null,
      }),
    );
  }

  listarPersonas(userId: string): Promise<Persona[]> {
    return this.personas.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Consulta a geração do retrato e, quando pronta, espelha no S3.
   *
   * O espelhamento não é detalhe: a URL da fornecedora expira, e uma persona
   * que perde o retrato perde a consistência de rosto de toda campanha futura.
   */
  async atualizarPersona(userId: string, id: string): Promise<Persona> {
    const persona = await this.personas.findOneBy({ id, userId });
    if (!persona) throw new NotFoundException('Persona não encontrada.');
    if (persona.status !== 'gerando' || !persona.seedMediaId) return persona;

    const media = await this.videogen.refresh(userId, persona.seedMediaId);
    if (media.status === 'completed') {
      const origem = media.outputUrl ?? media.imageUrl;
      const espelhada = origem
        ? await this.mirror.mirror(origem, 'personas', persona.id)
        : null;
      if (espelhada) {
        persona.seedImageUrl = espelhada;
        persona.status = 'pronta';
      } else {
        persona.status = 'falhou';
        this.logger.warn(`Retrato da persona ${persona.id} não pôde ser espelhado.`);
      }
    } else if (['failed', 'nsfw', 'canceled'].includes(media.status)) {
      persona.status = 'falhou';
    }
    return this.personas.save(persona);
  }

  async removerPersona(userId: string, id: string): Promise<void> {
    const r = await this.personas.delete({ id, userId });
    if (!r.affected) throw new NotFoundException('Persona não encontrada.');
  }

  // --------------------------------------------------------------- campanhas
  async criarCampanha(userId: string, dto: CreateCampaignDto): Promise<Campaign> {
    const produto = await this.produtos.findOneBy({ id: dto.userProductId, userId });
    if (!produto) throw new NotFoundException('Produto não encontrado.');
    const persona = await this.personas.findOneBy({ id: dto.personaId, userId });
    if (!persona) throw new NotFoundException('Persona não encontrada.');

    return this.campanhas.save(
      this.campanhas.create({
        userId,
        userProductId: produto.id,
        personaId: persona.id,
        title: produto.name,
        durationSeconds: dto.durationSeconds ?? 15,
        status: 'rascunho',
      }),
    );
  }

  listarCampanhas(userId: string): Promise<Campaign[]> {
    return this.campanhas.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /** Campanha com cenas — é o que a tela de detalhe consome. */
  async detalharCampanha(userId: string, id: string) {
    const campanha = await this.campanhas.findOneBy({ id, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');
    const [produto, persona, cenas] = await Promise.all([
      this.produtos.findOneBy({ id: campanha.userProductId }),
      this.personas.findOneBy({ id: campanha.personaId }),
      this.cenas.find({ where: { campaignId: id }, order: { ordem: 'ASC' } }),
    ]);
    return { ...campanha, produto, persona, cenas };
  }

  /**
   * Gera o roteiro e o storyboard numa cobrança só, e regrava as cenas.
   * Rodar de novo substitui o storyboard inteiro — por isso é bloqueado
   * depois que alguma cena já foi renderizada (seria jogar crédito fora).
   */
  async gerarRoteiro(userId: string, campaignId: string) {
    const campanha = await this.campanhas.findOneBy({ id: campaignId, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');

    const jaRenderizou = await this.cenas.count({
      where: { campaignId, status: 'pronta' },
    });
    if (jaRenderizou) {
      throw new ConflictException(
        'Esta campanha já tem cenas renderizadas. Crie uma nova campanha para mudar o roteiro.',
      );
    }

    const produto = await this.produtos.findOneBy({ id: campanha.userProductId });
    const persona = await this.personas.findOneBy({ id: campanha.personaId });
    if (!produto || !persona) {
      throw new NotFoundException('Produto ou persona da campanha não existe mais.');
    }

    const pedido = {
      productName: produto.name,
      benefit: produto.benefit,
      problemSolved: produto.problemSolved,
      priceBrl: produto.priceBrl === null ? null : Number(produto.priceBrl),
      cenas: this.cenasPara(campanha.durationSeconds),
      persona: persona.label,
      temFotoDoProduto: produto.images.length > 0,
      referencias: await this.ganchosDaCategoria(produto),
    };

    const run = () => this.ai.generateCampaign(pedido);
    const resultado = this.ai.enabled
      ? await this.billing.withCharge(userId, 'script', run)
      : await run();

    await this.cenas.delete({ campaignId });
    await this.cenas.save(
      resultado.cenas.map((cena, i) => {
        const mostraProduto = cena.mostraProduto && produto.images.length > 0;
        return this.cenas.create({
          campaignId,
          ordem: i + 1,
          fala: cena.fala,
          acaoVisual: cena.acaoVisual,
          tipo: mostraProduto ? 'produto' : 'apresentador',
          // Alterna entre as fotos disponíveis para não repetir o mesmo
          // enquadramento em duas demonstrações seguidas.
          baseImageUrl: mostraProduto
            ? produto.images[i % produto.images.length]
            : null,
          status: 'pendente',
        });
      }),
    );

    campanha.script = resultado.content;
    campanha.model = resultado.model;
    campanha.status = 'storyboard';
    if (this.ai.enabled) campanha.creditsSpent += ACTION_PRICES.script.credits;
    await this.campanhas.save(campanha);

    return this.detalharCampanha(userId, campaignId);
  }

  /**
   * Ganchos que estão vendendo na categoria do produto — é o dado que só o
   * PikPok tem, e o que separa este roteiro de um genérico.
   *
   * Por enquanto sai de uma busca por palavra na legenda. Quando o índice
   * semântico existir, é só esta consulta que muda: quem chama continua
   * recebendo uma lista de frases.
   */
  private async ganchosDaCategoria(produto: UserProduct): Promise<string[]> {
    const categoria = produto.sourceProductId
      ? (await this.catalogo.findOneBy({ id: produto.sourceProductId }))?.category
      : null;
    if (!categoria) return [];

    const linhas = await this.videos
      .createQueryBuilder('v')
      .select('v.caption', 'caption')
      .innerJoin(Product, 'p', 'p.id = v."productId"')
      .where('p.category = :categoria', { categoria })
      .andWhere("v.caption IS NOT NULL AND length(v.caption) > 20")
      .orderBy('v.views', 'DESC')
      .limit(MAX_REFERENCIAS)
      .getRawMany<{ caption: string }>();

    return linhas.map((l) => l.caption);
  }

  /** O vendedor ajusta fala e ação antes de gastar crédito de vídeo. */
  async editarCena(userId: string, sceneId: string, dto: UpdateSceneDto) {
    const cena = await this.cenaDoUsuario(userId, sceneId);
    if (cena.status === 'pronta') {
      throw new ConflictException('Cena já renderizada não pode ser editada.');
    }
    if (dto.fala !== undefined) cena.fala = dto.fala;
    if (dto.acaoVisual !== undefined) cena.acaoVisual = dto.acaoVisual;
    return this.cenas.save(cena);
  }

  /**
   * Renderiza UMA cena. A cobrança é aqui, cena a cena: cobrar a campanha
   * inteira na frente quebra quando o vendedor desiste na metade, porque
   * ninguém sabe quanto devolver.
   */
  async renderizarCena(userId: string, sceneId: string) {
    const cena = await this.cenaDoUsuario(userId, sceneId);
    if (cena.status === 'renderizando') {
      throw new ConflictException('Esta cena já está sendo gerada.');
    }
    if (cena.status === 'pronta') return cena;

    const campanha = await this.campanhas.findOneByOrFail({ id: cena.campaignId });

    /**
     * De onde a cena parte muda tudo:
     *
     *  - cena de produto anima a FOTO REAL enviada pelo vendedor, então o
     *    anúncio mostra o produto dele e não um objeto parecido inventado;
     *  - cena de apresentador parte do retrato-semente, que é o que mantém o
     *    mesmo rosto em todas as cenas.
     *
     * Em ambos os casos a aparência vem da imagem base e do fragmento da
     * persona — nunca do texto que o vendedor digitou. A montagem acontece
     * aqui, no servidor, e não chega pronta do cliente: é o que impede o campo
     * de ação de redefinir quem (ou o quê) aparece.
     */
    let imagemBase: string | null;
    let promptFinal: string;

    if (cena.tipo === 'produto') {
      imagemBase = cena.baseImageUrl;
      if (!imagemBase) {
        throw new ConflictException(
          'Esta cena mostra o produto, mas a foto não está mais disponível. ' +
            'Envie uma foto e gere o roteiro de novo.',
        );
      }
      promptFinal = `Product demo shot. Camera motion: ${cena.acaoVisual}. No people in frame.`;
    } else {
      const persona = await this.personas.findOneBy({ id: campanha.personaId });
      if (!persona?.seedImageUrl || persona.status !== 'pronta') {
        throw new ConflictException(
          'O retrato do apresentador ainda não está pronto. Aguarde antes de renderizar.',
        );
      }
      imagemBase = persona.seedImageUrl;
      promptFinal = `${persona.promptFragment}. Action: ${cena.acaoVisual}`;
    }

    const media = await this.videogen.generateFromImage(
      userId,
      imagemBase,
      promptFinal,
    );

    cena.promptFinal = promptFinal;
    cena.generatedMediaId = media.id;
    cena.status = 'renderizando';
    cena.error = null;
    await this.cenas.save(cena);

    campanha.creditsSpent += ACTION_PRICES.video.credits;
    campanha.status = 'renderizando';
    await this.campanhas.save(campanha);

    return cena;
  }

  /** Consulta as cenas em andamento e fecha a campanha quando todas concluem. */
  async atualizarCampanha(userId: string, campaignId: string) {
    const campanha = await this.campanhas.findOneBy({ id: campaignId, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');

    const cenas = await this.cenas.find({ where: { campaignId } });
    for (const cena of cenas) {
      if (cena.status !== 'renderizando' || !cena.generatedMediaId) continue;
      const media = await this.videogen.refresh(userId, cena.generatedMediaId);
      if (media.status === 'completed' && media.outputUrl) {
        // Espelha antes de guardar: o MP4 da fornecedora expira em horas.
        cena.outputUrl =
          (await this.mirror.mirror(media.outputUrl, 'campaign-scenes', cena.id)) ??
          media.outputUrl;
        cena.status = 'pronta';
      } else if (['failed', 'nsfw', 'canceled'].includes(media.status)) {
        // O estorno já aconteceu dentro do refresh do videogen.
        cena.status = 'falhou';
        cena.error = media.error ?? 'A geração falhou.';
        campanha.creditsSpent = Math.max(
          0,
          campanha.creditsSpent - ACTION_PRICES.video.credits,
        );
      }
      await this.cenas.save(cena);
    }

    const atualizadas = await this.cenas.find({ where: { campaignId } });
    const todasProntas =
      atualizadas.length > 0 && atualizadas.every((c) => c.status === 'pronta');
    if (todasProntas) campanha.status = 'pronta';
    await this.campanhas.save(campanha);

    /**
     * Monta sozinho assim que a última cena fica pronta. É o que o vendedor
     * quer: ele pediu um vídeo, não seis pedaços. Falha aqui não pode derrubar
     * a consulta de status — as cenas continuam prontas e o botão de montar
     * de novo fica disponível.
     */
    if (todasProntas && !campanha.finalVideoUrl && this.assembly.enabled) {
      try {
        return await this.montar(userId, campaignId);
      } catch (error) {
        this.logger.warn(`Montagem automática falhou (${campaignId}): ${error}`);
      }
    }

    return this.detalharCampanha(userId, campaignId);
  }

  /**
   * Monta as cenas prontas num único MP4.
   *
   * Não cobra créditos: é processamento nosso, sem chamada de IA. Exige TODAS
   * as cenas prontas de propósito — montar pela metade entrega um vídeo que
   * corta no meio da frase, e o vendedor publicaria sem perceber.
   */
  async montar(userId: string, campaignId: string) {
    const campanha = await this.campanhas.findOneBy({ id: campaignId, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');
    if (!this.assembly.enabled) {
      throw new ConflictException(
        'A montagem não está disponível neste servidor (ffmpeg ausente).',
      );
    }

    const cenas = await this.cenas.find({
      where: { campaignId },
      order: { ordem: 'ASC' },
    });
    if (!cenas.length) {
      throw new ConflictException('Gere o roteiro antes de montar.');
    }
    const pendentes = cenas.filter((c) => c.status !== 'pronta');
    if (pendentes.length) {
      throw new ConflictException(
        `Faltam ${pendentes.length} cena(s) para renderizar antes de montar.`,
      );
    }

    // As cenas estão no nosso bucket: lê direto, sem passar pela rede pública.
    const arquivos: Buffer[] = [];
    for (const cena of cenas) {
      const buffer = await this.lerCena(cena.outputUrl);
      if (!buffer) {
        throw new ConflictException(
          `O vídeo da cena ${cena.ordem} não pôde ser lido. Renderize-a de novo.`,
        );
      }
      arquivos.push(buffer);
    }

    const final = await this.assembly.juntar(arquivos);
    const url = await this.mirror.putVideo(final, 'campaign-final', campanha.id);
    if (!url) {
      throw new ConflictException('O vídeo montado não pôde ser guardado.');
    }

    campanha.finalVideoUrl = url;
    campanha.status = 'pronta';
    await this.campanhas.save(campanha);
    this.logger.log(
      `Campanha ${campanha.id} montada: ${cenas.length} cenas, ${Math.round(final.byteLength / 1024)}KB`,
    );

    return this.detalharCampanha(userId, campaignId);
  }

  /** Lê o MP4 da cena — do bucket quando é nosso, da URL quando ainda não é. */
  private async lerCena(url: string | null): Promise<Buffer | null> {
    if (!url) return null;
    const prefixo = `${MEDIA_ROUTE}/`;
    if (url.startsWith(prefixo)) {
      const objeto = await this.mirror.readObject(url.slice(prefixo.length));
      return objeto?.body ?? null;
    }
    try {
      const resposta = await fetch(url);
      if (!resposta.ok) return null;
      return Buffer.from(await resposta.arrayBuffer());
    } catch {
      return null;
    }
  }

  async removerCampanha(userId: string, id: string): Promise<void> {
    const r = await this.campanhas.delete({ id, userId });
    if (!r.affected) throw new NotFoundException('Campanha não encontrada.');
  }

  /** Toda cena é alcançada pelo dono da campanha — nunca pelo id solto. */
  private async cenaDoUsuario(userId: string, sceneId: string): Promise<CampaignScene> {
    const cena = await this.cenas
      .createQueryBuilder('s')
      .innerJoin(Campaign, 'c', 'c.id = s."campaignId"')
      .where('s.id = :sceneId AND c."userId" = :userId', { sceneId, userId })
      .getOne();
    if (!cena) throw new NotFoundException('Cena não encontrada.');
    return cena;
  }
}
