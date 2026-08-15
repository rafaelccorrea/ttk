import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Creator } from '../creators/entities/creator.entity';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { Product } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';
import { Video } from '../videos/entities/video.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(ProductMetricDaily)
    private readonly metrics: Repository<ProductMetricDaily>,
    private readonly productsService: ProductsService,
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    @InjectRepository(Creator)
    private readonly creators: Repository<Creator>,
  ) {}

  async overview(userId: string) {
    const [totals, productCount, categoryCount, top, topVideos, topCreators] =
      await Promise.all([
      this.metrics
        .createQueryBuilder('m')
        .select('COALESCE(SUM(m.sales), 0)', 'sales')
        .addSelect('COALESCE(SUM(m.revenue), 0)', 'revenue')
        .getRawOne(),
      this.products.count(),
      this.products
        .createQueryBuilder('p')
        .select('COUNT(DISTINCT p.category)', 'count')
        .getRawOne(),
        this.productsService.rank({ period: 7, page: 1, limit: 5 }, userId),
        this.videos.find({ order: { views: 'DESC' }, take: 5 }),
        this.creators
          .createQueryBuilder('c')
          .orderBy('c.gmvPeriod', 'DESC')
          .take(5)
          .getMany(),
      ]);

    return {
      totalSales: Number(totals.sales),
      totalRevenue: Number(totals.revenue),
      totalProducts: productCount,
      totalCategories: Number(categoryCount.count),
      topProducts: top.items,
      topVideos: topVideos.map((v) => ({
        id: v.id,
        caption: v.caption,
        creatorHandle: v.creatorHandle,
        views: v.views,
        revenueEstimate: Number(v.revenueEstimate),
        category: v.category,
        thumbnailUrl: v.thumbnailUrl ?? null,
        videoUrl: v.videoUrl ?? null,
        playbackUrl: v.playbackUrl ?? null,
      })),
      topCreators: topCreators.map((c) => ({
        id: c.id,
        name: c.name,
        handle: c.handle,
        followers: c.followers,
        gmvPeriod: Number(c.gmvPeriod),
        avatarUrl: c.avatarUrl ?? null,
      })),
    };
  }
}
