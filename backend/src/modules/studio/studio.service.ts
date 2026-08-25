import { garantirConteudoPermitido } from '../../common/moderacao';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { Product } from '../products/entities/product.entity';
import { UserProduct } from '../campaigns/entities/user-product.entity';
import { MEDIA_ROUTE, MediaMirrorService } from '../media/media-mirror.service';
import { AiService } from './ai.service';
import { GenerateScriptDto } from './dto/generate-script.dto';
import type { JobContexto } from '../jobs/jobs.service';

/** O que `prepararGeracao` resolve antes de o roteiro virar job. */
export interface GeracaoPreparada {
  productName: string;
  productDescription?: string;
  price?: number;
}
import { PromptTemplate } from './entities/prompt-template.entity';
import { Script } from './entities/script.entity';

@Injectable()
export class StudioService {
  constructor(
    @InjectRepository(Script)
    private readonly scripts: Repository<Script>,
    @InjectRepository(PromptTemplate)
    private readonly prompts: Repository<PromptTemplate>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(UserProduct)
    private readonly userProducts: Repository<UserProduct>,
    private readonly aiService: AiService,
    private readonly billing: BillingService,
    private readonly mirror: MediaMirrorService,
  ) {}

  /** Guarda a foto do produto enviada no roteirizador e devolve a URL. */
  async salvarFotoDoProduto(userId: string, buffer: Buffer): Promise<{ url: string }> {
    // `contain` e não `cover`: recortar a foto de um produto corta justamente
    // a parte que interessa (o produto inteiro no quadro).
    const url = await this.mirror.putImage(
      buffer,
      'studio-products',
      `${userId}-${Date.now()}`,
      'contain',
    );
    if (!url) {
      throw new BadRequestException(
        'A imagem não pôde ser guardada. Envie um PNG ou JPG de até 40MB.',
      );
    }
    return { url };
  }

  /**
   * Lê a foto de volta como base64 para mandar ao modelo.
   *
   * Só aceita objeto do nosso bucket: a URL vem do cliente, e buscar qualquer
   * endereço que ele mandar transformaria o servidor em proxy de saída.
   */
  private async fotoParaModelo(
    url?: string,
  ): Promise<{ base64: string; mediaType: string } | undefined> {
    if (!url) return undefined;
    // A tela manda a mesma URL que usa para exibir, às vezes já com a origem
    // da API na frente. Só o caminho interessa — o host é descartado, então
    // uma URL de fora não vira busca em servidor de terceiro.
    const caminho = url.startsWith('http')
      ? (() => {
          try {
            return new URL(url).pathname;
          } catch {
            return '';
          }
        })()
      : url;
    const prefixo = `${MEDIA_ROUTE}/`;
    if (!caminho.startsWith(prefixo)) return undefined;
    const objeto = await this.mirror.readObject(caminho.slice(prefixo.length));
    if (!objeto) return undefined;
    return {
      base64: objeto.body.toString('base64'),
      mediaType: objeto.contentType,
    };
  }

  /**
   * Ficha do produto cadastrado pelo próprio vendedor.
   *
   * Busca sempre presa ao `userId`: o id vem do cliente, e sem esse filtro
   * um usuário leria o produto de outro só chutando uuid.
   */
  private async fichaDoProdutoDoUsuario(
    userId: string,
    id: string,
  ): Promise<{ name: string; price?: number; description: string }> {
    const produto = await this.userProducts.findOneBy({ id, userId });
    if (!produto) {
      throw new NotFoundException(`Produto ${id} não encontrado`);
    }
    const price =
      produto.priceBrl === null ? undefined : Number(produto.priceBrl);
    const description = [
      produto.benefit ? `Benefício principal: ${produto.benefit}` : null,
      produto.problemSolved ? `Problema que resolve: ${produto.problemSolved}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    return { name: produto.name, price, description };
  }

  /**
   * Tudo que pode dar erro de validação na geração de roteiro — resolvido no
   * request, antes de virar job, para o usuário receber um 4xx normal.
   */
  async prepararGeracao(
    userId: string,
    dto: GenerateScriptDto,
  ): Promise<GeracaoPreparada> {
    // O nome e a descrição digitados viram prompt sem outra revisão.
    garantirConteudoPermitido({
      productName: dto.productName,
      productDescription: dto.productDescription,
    });
    let productName = dto.productName ?? '';
    let productDescription = dto.productDescription;
    let price: number | undefined;

    if (dto.productId) {
      const product = await this.products.findOneBy({ id: dto.productId });
      if (!product) {
        throw new NotFoundException(`Produto ${dto.productId} não encontrado`);
      }
      productName = product.title;
      price = Number(product.price);
      productDescription =
        productDescription ??
        `Categoria: ${product.category}. Loja: ${product.storeName ?? 'n/d'}.`;
    } else if (dto.userProductId) {
      const ficha = await this.fichaDoProdutoDoUsuario(
        userId,
        dto.userProductId,
      );
      productName = ficha.name;
      price = ficha.price;
      productDescription = productDescription ?? (ficha.description || undefined);
    }
    return { productName, productDescription, price };
  }

  async generate(
    userId: string,
    dto: GenerateScriptDto,
    preparado?: GeracaoPreparada,
    ctx?: JobContexto,
  ): Promise<Script> {
    const { productName, productDescription, price } =
      preparado ?? (await this.prepararGeracao(userId, dto));

    const productImage = await this.fotoParaModelo(dto.productImageUrl);

    // Gerador local (sem chave de IA) é gratuito; Claude real cobra créditos.
    const run = async () => {
      // Cobrado: se o servidor cair daqui até o fim, o cron devolve.
      await ctx?.cobrado('script');
      return this.aiService.generateScript({
        type: dto.type,
        productName,
        productDescription,
        price,
        tone: dto.tone,
        productImage,
        formato: dto.formato,
        pecas: {
          hooks: dto.hooksCount,
          bodies: dto.bodiesCount,
          ctas: dto.ctasCount,
        },
      });
    };
    const result = this.aiService.enabled
      ? await this.billing.withCharge(userId, 'script', run, 1, undefined, productName)
      : await run();

    await ctx?.progresso(90, 'Salvando');
    return this.scripts.save(
      this.scripts.create({
        userId,
        type: dto.type,
        productName,
        productDescription,
        content: result.content,
        model: result.model,
      }),
    );
  }

  /** Analisa a transcrição de um vídeo viral e salva como roteiro do usuário. */
  async analyze(
    userId: string,
    transcript: string,
    productId?: string,
    userProductId?: string,
    ctx?: JobContexto,
  ): Promise<Script> {
    let productName: string | undefined;
    let price: number | undefined;
    if (userProductId && !productId) {
      const ficha = await this.fichaDoProdutoDoUsuario(userId, userProductId);
      productName = ficha.name;
      price = ficha.price;
    }
    if (productId) {
      const product = await this.products.findOneBy({ id: productId });
      if (!product) {
        throw new NotFoundException(`Produto ${productId} não encontrado`);
      }
      productName = product.title;
      price = Number(product.price);
    }

    const run = async () => {
      await ctx?.cobrado('analyze');
      return this.aiService.analyzeTranscript(transcript, productName, price);
    };
    const result = this.aiService.enabled
      ? await this.billing.withCharge(userId, 'analyze', run)
      : await run();
    await ctx?.progresso(90, 'Salvando');
    return this.scripts.save(
      this.scripts.create({
        userId,
        type: 'video',
        productName: productName ?? 'Análise de vídeo viral',
        productDescription: `Transcrição analisada: ${transcript.slice(0, 500)}`,
        content: result.content,
        model: result.model,
      }),
    );
  }

  listScripts(userId: string): Promise<Script[]> {
    return this.scripts.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteScript(userId: string, id: string): Promise<void> {
    // Escopado ao usuário: ninguém apaga roteiro de outro.
    const result = await this.scripts.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(`Roteiro ${id} não encontrado`);
    }
  }

  listPrompts(filters: {
    mediaType?: 'video' | 'image';
    niche?: string;
    search?: string;
  }): Promise<PromptTemplate[]> {
    const qb = this.prompts.createQueryBuilder('t').orderBy('t.createdAt', 'DESC');
    if (filters.mediaType) {
      qb.andWhere('t.mediaType = :mediaType', { mediaType: filters.mediaType });
    }
    if (filters.niche) {
      qb.andWhere('t.niches LIKE :niche', { niche: `%${filters.niche}%` });
    }
    if (filters.search) {
      qb.andWhere('(t.title ILIKE :search OR t.tags LIKE :search)', {
        search: `%${filters.search}%`,
      });
    }
    return qb.getMany();
  }
}
