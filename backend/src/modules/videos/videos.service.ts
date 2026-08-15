import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryVideosDto } from './dto/query-videos.dto';
import { SavedVideo } from './entities/saved-video.entity';
import { Video } from './entities/video.entity';

export interface VideoItem {
  id: string;
  caption: string;
  creatorHandle: string;
  views: number;
  likes: number;
  revenueEstimate: number;
  postedAt: string;
  transcript: string | null;
  productId: string | null;
  category: string;
  isSaved: boolean;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  playbackUrl: string | null;
  /** Foto do produto associado: capa de fallback quando não há thumbnail. */
  productImageUrl: string | null;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    @InjectRepository(SavedVideo)
    private readonly savedVideos: Repository<SavedVideo>,
  ) {}

  private toItem(video: Video, savedIds: Set<string>): VideoItem {
    return {
      id: video.id,
      caption: video.caption,
      creatorHandle: video.creatorHandle,
      views: video.views,
      likes: video.likes,
      revenueEstimate: Number(video.revenueEstimate),
      postedAt: video.postedAt,
      transcript: video.transcript,
      productId: video.productId,
      category: video.category,
      isSaved: savedIds.has(video.id),
      videoUrl: video.videoUrl ?? null,
      thumbnailUrl: video.thumbnailUrl ?? null,
      playbackUrl: video.playbackUrl ?? null,
      productImageUrl: video.product?.imageUrl ?? null,
    };
  }

  async list(
    query: QueryVideosDto,
    userId: string,
  ): Promise<{ items: VideoItem[]; total: number; page: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;

    const savedIds = new Set(
      (await this.savedVideos.find({ where: { userId } })).map(
        (s) => s.videoId,
      ),
    );

    // Desempate por id para paginação estável (sort do Postgres não é estável).
    const qb = this.videos
      .createQueryBuilder('v')
      // Traz o produto para usar a foto dele como capa quando falta thumbnail.
      .leftJoinAndSelect('v.product', 'product')
      .orderBy('v.views', 'DESC')
      .addOrderBy('v.id', 'ASC');

    if (query.saved) {
      if (savedIds.size === 0) {
        return { items: [], total: 0, page };
      }
      qb.andWhere('v.id IN (:...savedIds)', { savedIds: [...savedIds] });
    }
    if (query.productId) {
      qb.andWhere('v.productId = :productId', { productId: query.productId });
    }
    if (query.category) {
      qb.andWhere('v.category = :category', { category: query.category });
    }
    if (query.kind) {
      qb.andWhere('v.kind = :kind', { kind: query.kind });
    } else if (!query.saved && !query.productId) {
      // Vídeos que Vendem = só anúncio confirmado como venda de produto.
      // 'pending' (ainda não analisado) e 'other' (serviço/app/outro idioma)
      // ficam de fora — era o que trazia "Ton", "Inverno" e anúncio em inglês.
      qb.andWhere('v.kind = :defaultKind', { defaultKind: 'product' });
    }
    // Vídeo sem mídia não abre e frustra o usuário ("não consigo executar
    // nenhum vídeo"). Por padrão listamos só o que realmente reproduz.
    if (query.playable !== false && !query.saved) {
      qb.andWhere(
        '(v."playbackUrl" IS NOT NULL OR v."videoUrl" IS NOT NULL)',
      );
    }
    if (query.search) {
      qb.andWhere('(v.caption ILIKE :search OR v.creatorHandle ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items: rows.map((v) => this.toItem(v, savedIds)), total, page };
  }

  async findOne(id: string, userId: string) {
    const video = await this.videos.findOne({
      where: { id },
      relations: { product: true },
    });
    if (!video) {
      throw new NotFoundException(`Vídeo ${id} não encontrado`);
    }
    const isSaved = Boolean(
      await this.savedVideos.findOneBy({ userId, videoId: id }),
    );
    return {
      ...this.toItem(video, isSaved ? new Set([id]) : new Set<string>()),
      product: video.product
        ? {
            id: video.product.id,
            title: video.product.title,
            category: video.product.category,
            price: Number(video.product.price),
            imageUrl: video.product.imageUrl,
          }
        : null,
    };
  }

  async toggleSave(
    userId: string,
    videoId: string,
  ): Promise<{ isSaved: boolean }> {
    const existing = await this.savedVideos.findOneBy({ userId, videoId });
    if (existing) {
      await this.savedVideos.delete({ id: existing.id });
      return { isSaved: false };
    }
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video) {
      throw new NotFoundException(`Vídeo ${videoId} não encontrado`);
    }
    await this.savedVideos.save(this.savedVideos.create({ userId, videoId }));
    return { isSaved: true };
  }
}
