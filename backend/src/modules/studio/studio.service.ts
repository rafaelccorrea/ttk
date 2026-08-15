import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { Product } from '../products/entities/product.entity';
import { UserProduct } from '../campaigns/entities/user-product.entity';
import { AiService } from './ai.service';
import { GenerateScriptDto } from './dto/generate-script.dto';
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
  ) {}

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

  async generate(userId: string, dto: GenerateScriptDto): Promise<Script> {
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

    // Gerador local (sem chave de IA) é gratuito; Claude real cobra créditos.
    const run = () =>
      this.aiService.generateScript({
        type: dto.type,
        productName,
        productDescription,
        price,
        tone: dto.tone,
      });
    const result = this.aiService.enabled
      ? await this.billing.withCharge(userId, 'script', run)
      : await run();

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

    const run = () =>
      this.aiService.analyzeTranscript(transcript, productName, price);
    const result = this.aiService.enabled
      ? await this.billing.withCharge(userId, 'analyze', run)
      : await run();
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
