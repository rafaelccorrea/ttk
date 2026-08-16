import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { Trend } from './entities/trend.entity';
import { TrendsController } from './trends.controller';
import { TrendsService } from './trends.service';

@Module({
  // BillingModule: o PlanFeatureGuard do controller depende do BillingService.
  imports: [
    TypeOrmModule.forFeature([Trend, ProductMetricDaily]),
    UsersModule,
    BillingModule,
  ],
  controllers: [TrendsController],
  providers: [TrendsService],
  exports: [TrendsService],
})
export class TrendsModule {}
