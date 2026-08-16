import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { CreatorsController } from './creators.controller';
import { CreatorsService } from './creators.service';
import { Creator } from './entities/creator.entity';

@Module({
  // BillingModule: o PlanFeatureGuard do controller depende do BillingService.
  imports: [TypeOrmModule.forFeature([Creator]), UsersModule, BillingModule],
  controllers: [CreatorsController],
  providers: [CreatorsService],
  exports: [CreatorsService],
})
export class CreatorsModule {}
