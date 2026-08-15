import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
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
    private readonly aiService: AiService,
  ) {}

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
    }

    const result = await this.aiService.generateScript({
      type: dto.type,
      productName,
      productDescription,
      price,
      tone: dto.tone,
    });

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
  ): Promise<Script> {
    let productName: string | undefined;
    let price: number | undefined;
    if (productId) {
      const product = await this.products.findOneBy({ id: productId });
      if (!product) {
        throw new NotFoundException(`Produto ${productId} não encontrado`);
      }
      productName = product.title;
      price = Number(product.price);
    }

    const result = await this.aiService.analyzeTranscript(
      transcript,
      productName,
      price,
    );
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
