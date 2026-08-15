import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmConfig } from './config/typeorm.config';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { CombinationsModule } from './modules/combinations/combinations.module';
import { CreatorsModule } from './modules/creators/creators.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { MediaModule } from './modules/media/media.module';
import { ProductsModule } from './modules/products/products.module';
import { StudioModule } from './modules/studio/studio.module';
import { SupportModule } from './modules/support/support.module';
import { TrendsModule } from './modules/trends/trends.module';
import { VideosModule } from './modules/videos/videos.module';
import { UsersModule } from './modules/users/users.module';
import { VideogenModule } from './modules/videogen/videogen.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: typeOrmConfig,
    }),
    AuthModule,
    BillingModule,
    CombinationsModule,
    CreatorsModule,
    IngestionModule,
    MediaModule,
    UsersModule,
    ProductsModule,
    StudioModule,
    SupportModule,
    AnalyticsModule,
    TrendsModule,
    VideosModule,
    VideogenModule,
  ],
})
export class AppModule {}
