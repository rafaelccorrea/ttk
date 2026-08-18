import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { BillingCycle } from './billing.config';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';

class PurchasePackDto {
  @IsString()
  packId: string;
}

class SubscribeDto {
  @IsString()
  planId: string;

  /** 'month' (padrão) ou 'year', quando o plano tem opção anual. */
  @IsOptional()
  @IsIn(['month', 'year'])
  cycle?: BillingCycle;
}

class CheckoutDto {
  @IsOptional()
  @IsString()
  packId?: string;

  @IsOptional()
  @IsString()
  planId?: string;

  /** Add-on de horas de live (ver LIVE_HOUR_PACKS) — outra moeda, outro saldo. */
  @IsOptional()
  @IsString()
  livePackId?: string;

  @IsOptional()
  @IsIn(['month', 'year'])
  cycle?: BillingCycle;
}

class ConfirmDto {
  @IsString()
  sessionId: string;
}

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly stripeService: StripeService,
  ) {}

  @Post('checkout')
  @ApiOperation({
    summary: 'Cria uma sessão de pagamento no Stripe (pack, horas de live ou plano)',
  })
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.stripeService.createCheckout(user.id, user.email, {
      packId: dto.packId,
      planId: dto.planId,
      livePackId: dto.livePackId,
      cycle: dto.cycle,
    });
  }

  @Post('checkout/confirm')
  @ApiOperation({ summary: 'Confirma o pagamento (verificado na API do Stripe) e credita' })
  confirm(@CurrentUser() user: AuthUser, @Body() dto: ConfirmDto) {
    return this.stripeService.confirmSession(user.id, dto.sessionId);
  }

  @Post('portal')
  @ApiOperation({
    summary: 'Abre o Billing Portal do Stripe (cancelar, trocar cartão, faturas)',
  })
  portal(@CurrentUser() user: AuthUser) {
    return this.stripeService.createPortalSession(user.id);
  }

  @Get('wallet')
  @ApiOperation({ summary: 'Saldo, preços das ações e extrato do usuário' })
  wallet(@CurrentUser() user: AuthUser) {
    return this.billing.getWallet(user.id);
  }

  @Get('plans')
  @ApiOperation({ summary: 'Planos disponíveis' })
  plans() {
    return this.billing.listPlans();
  }

  @Get('packs')
  @ApiOperation({ summary: 'Pacotes de créditos avulsos' })
  packs() {
    return this.billing.listPacks();
  }

  @Post('packs/purchase')
  @ApiOperation({ summary: 'Compra um pacote de créditos (dev: crédito imediato)' })
  purchase(@CurrentUser() user: AuthUser, @Body() dto: PurchasePackDto) {
    return this.billing.purchasePack(user.id, dto.packId);
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Assina um plano (dev: créditos imediatos)' })
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.billing.subscribe(user.id, dto.planId, dto.cycle);
  }
}
