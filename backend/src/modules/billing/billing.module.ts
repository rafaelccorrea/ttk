import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { UsersModule } from '../users/users.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CreditTransaction } from './entities/credit-transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AppUser, CreditTransaction]),
    UsersModule,
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
