import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmConfig } from './config/typeorm.config';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { CombinationsModule } from './modules/combinations/combinations.module';
import { CreatorsModule } from './modules/creators/creators.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { MediaModule } from './modules/media/media.module';
import { ProductsModule } from './modules/products/products.module';
import { AdminModule } from './modules/admin/admin.module';
import { ShowcaseModule } from './modules/showcase/showcase.module';
import { StudioModule } from './modules/studio/studio.module';
import { SupportModule } from './modules/support/support.module';
import { TrendsModule } from './modules/trends/trends.module';
import { VideosModule } from './modules/videos/videos.module';
import { UsersModule } from './modules/users/users.module';
import { VideogenModule } from './modules/videogen/videogen.module';

@Module({
  imports: [
    // .env.<NODE_ENV> tem precedência sobre .env (o primeiro que define a
    // chave vence), então .env.production sobrescreve os valores de dev.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
    }),
    // Teto global de requisições por IP. Os limites apertados (login,
    // cadastro, reset de senha, proxy de mídia) vêm por rota com @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: typeOrmConfig,
    }),
    AuthModule,
    BillingModule,
    CampaignsModule,
    CombinationsModule,
    CreatorsModule,
    IngestionModule,
    MediaModule,
    UsersModule,
    ProductsModule,
    ShowcaseModule,
    AdminModule,
    StudioModule,
    SupportModule,
    AnalyticsModule,
    TrendsModule,
    VideosModule,
    VideogenModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
