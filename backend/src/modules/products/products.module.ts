import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { ProductFavorite } from './entities/product-favorite.entity';
import { ProductMetricDaily } from './entities/product-metric-daily.entity';
import { Product } from './entities/product.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, ProductMetricDaily, ProductFavorite]),
    UsersModule,
    // O PlanFeatureGuard do controller depende do BillingService.
    BillingModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
