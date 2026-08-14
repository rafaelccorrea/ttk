import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { Product } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(ProductMetricDaily)
    private readonly metrics: Repository<ProductMetricDaily>,
    private readonly productsService: ProductsService,
  ) {}

  async overview(userId: string) {
    const [totals, productCount, categoryCount, top] = await Promise.all([
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
    ]);

    return {
      totalSales: Number(totals.sales),
      totalRevenue: Number(totals.revenue),
      totalProducts: productCount,
      totalCategories: Number(categoryCount.count),
      topProducts: top.items,
    };
  }
}
