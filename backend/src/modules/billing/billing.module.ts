import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { UsersModule } from '../users/users.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CreditTransaction } from './entities/credit-transaction.entity';
import { PlanFeatureGuard } from './plan-feature.guard';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AppUser, CreditTransaction]),
    UsersModule,
  ],
  controllers: [BillingController, StripeWebhookController],
  providers: [BillingService, StripeService, PlanFeatureGuard],
  // StripeService sai daqui porque o painel administrativo apura a receita
  // direto na fonte (o Stripe), em vez de estimá-la pelos planos do banco.
  exports: [BillingService, PlanFeatureGuard, StripeService],
})
export class BillingModule {}
