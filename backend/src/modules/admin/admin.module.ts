import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { CreditTransaction } from '../billing/entities/credit-transaction.entity';
import { AppUser } from '../users/entities/app-user.entity';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AppUser, CreditTransaction]),
    UsersModule,
    BillingModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
