import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { CreditTransaction } from '../billing/entities/credit-transaction.entity';
import { AppUser } from '../users/entities/app-user.entity';
import { SupportModule } from '../support/support.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AppUser, CreditTransaction]),
    UsersModule,
    BillingModule,
    AuthModule,
    SupportModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
