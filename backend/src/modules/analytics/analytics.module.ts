import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Creator } from '../creators/entities/creator.entity';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { Product } from '../products/entities/product.entity';
import { Video } from '../videos/entities/video.entity';
import { ProductsModule } from '../products/products.module';
import { UsersModule } from '../users/users.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, ProductMetricDaily, Video, Creator]),
    ProductsModule,
    UsersModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
