import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { Creator } from '../creators/entities/creator.entity';
import { Trend } from '../trends/entities/trend.entity';
import { UsersModule } from '../users/users.module';
import { Video } from '../videos/entities/video.entity';
import { Product } from '../products/entities/product.entity';
import { CreativeCenterSource } from './creative-center.source';
import { CreativeCenterProductsSource } from './creative-center-products.source';
import { ExternalDataProvider } from './external-data.provider';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { ImageSearchSource } from './image-search.source';
import { IngestionRun } from './entities/ingestion-run.entity';
import { IngestionSetting } from './entities/ingestion-setting.entity';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trend, Creator, Video, Product, ProductMetricDaily, IngestionRun, IngestionSetting]),
    UsersModule,
    BillingModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    CreativeCenterSource,
    CreativeCenterProductsSource,
    ExternalDataProvider,
    ImageSearchSource,
  ],
})
export class IngestionModule {}
