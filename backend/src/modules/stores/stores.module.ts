import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ProductsModule } from '../products/products.module';
import { AppUser } from '../users/entities/app-user.entity';
import { UsersModule } from '../users/users.module';
import { StoreImport } from './entities/store-import.entity';
import { StoreOrderItem } from './entities/store-order-item.entity';
import { StoreOrder } from './entities/store-order.entity';
import { StoreProduct } from './entities/store-product.entity';
import { StoreSettlement } from './entities/store-settlement.entity';
import { Store } from './entities/store.entity';
import { StoresAlertsService } from './stores-alerts.service';
import { StoresAnalyticsService } from './stores-analytics.service';
import { StoresExportService } from './stores-export.service';
import { StoresController } from './stores.controller';
import { StoresImportService } from './stores-import.service';
import { StoresService } from './stores.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Store,
      StoreProduct,
      StoreOrder,
      StoreOrderItem,
      StoreSettlement,
      StoreImport,
      AppUser,
    ]),
    AuthModule,
    BillingModule,
    UsersModule,
    ProductsModule,
  ],
  controllers: [StoresController],
  providers: [
    StoresService,
    StoresImportService,
    StoresAnalyticsService,
    StoresExportService,
    StoresAlertsService,
  ],
  exports: [StoresService],
})
export class StoresModule {}
