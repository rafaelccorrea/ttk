import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { BillingService } from './billing.service';

class PurchasePackDto {
  @IsString()
  packId: string;
}

class SubscribeDto {
  @IsString()
  planId: string;
}

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

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
    return this.billing.subscribe(user.id, dto.planId);
  }
}
