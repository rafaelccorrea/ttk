import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmConfig } from './config/typeorm.config';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { CombinationsModule } from './modules/combinations/combinations.module';
import { CreatorsModule } from './modules/creators/creators.module';
import { ProductsModule } from './modules/products/products.module';
import { StudioModule } from './modules/studio/studio.module';
import { SupportModule } from './modules/support/support.module';
import { TrendsModule } from './modules/trends/trends.module';
import { VideosModule } from './modules/videos/videos.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: typeOrmConfig,
    }),
    AuthModule,
    CombinationsModule,
    CreatorsModule,
    UsersModule,
    ProductsModule,
    StudioModule,
    SupportModule,
    AnalyticsModule,
    TrendsModule,
    VideosModule,
  ],
})
export class AppModule {}
