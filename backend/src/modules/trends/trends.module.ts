import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { Trend } from './entities/trend.entity';
import { TrendsController } from './trends.controller';
import { TrendsService } from './trends.service';

@Module({
  imports: [TypeOrmModule.forFeature([Trend, ProductMetricDaily])],
  controllers: [TrendsController],
  providers: [TrendsService],
  exports: [TrendsService],
})
export class TrendsModule {}
