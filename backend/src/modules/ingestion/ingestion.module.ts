import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { MediaModule } from '../media/media.module';
import { Creator } from '../creators/entities/creator.entity';
import { Trend } from '../trends/entities/trend.entity';
import { UsersModule } from '../users/users.module';
import { Video } from '../videos/entities/video.entity';
import { Product } from '../products/entities/product.entity';
import { ApiArchiveService } from './api-archive.service';
import { ApiQuotaService } from './api-quota.service';
import { VitrineAuditService } from './vitrine-audit.service';
import { CreativeCenterSource } from './creative-center.source';
import { CreativeCenterProductsSource } from './creative-center-products.source';
import { ExternalDataProvider } from './external-data.provider';
import { ProductExtractorService } from './product-extractor.service';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { ImageSearchSource } from './image-search.source';
import { TikTokOembedSource } from './tiktok-oembed.source';
import { ApiRawResponse } from './entities/api-raw-response.entity';
import { IngestionRun } from './entities/ingestion-run.entity';
import { IngestionSetting } from './entities/ingestion-setting.entity';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trend, Creator, Video, Product, ProductMetricDaily, IngestionRun, IngestionSetting, ApiRawResponse]),
    UsersModule,
    BillingModule,
    MediaModule,
  ],
  controllers: [IngestionController],
  // O provider é exportado para o módulo de vídeos resolver o MP4 sob demanda.
  exports: [IngestionService, ExternalDataProvider, ApiQuotaService, ApiArchiveService, VitrineAuditService],
  providers: [
    ApiQuotaService,
    ApiArchiveService,
    VitrineAuditService,
    IngestionService,
    CreativeCenterSource,
    CreativeCenterProductsSource,
    ExternalDataProvider,
    ProductExtractorService,
    ImageSearchSource,
    TikTokOembedSource,
  ],
})
export class IngestionModule {}
