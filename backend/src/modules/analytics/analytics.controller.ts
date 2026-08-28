import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import { IngestionService } from '../ingestion/ingestion.service';
import { AnalyticsService } from './analytics.service';
import { UserThrottlerGuard } from '../../common/throttler/user-throttler.guard';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard, UserThrottlerGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly ingestionService: IngestionService,
  ) {}

  /*
   * O overview é dado de descoberta, não "meus números".
   *
   * Ele devolve o top 5 de produtos (o mesmo `productsService.rank` de
   * /products), o top de vídeos e o de criadores — tudo comprado do EchoTik,
   * que cobra por consulta. Sem este gate, /analytics/overview era a porta
   * lateral do paywall de `discovery`: bastava não abrir a tela de produtos.
   */
  @Get('overview')
  @RequiresPlanFeature('discovery')
  @ApiOperation({ summary: 'Números agregados para o dashboard' })
  overview(@CurrentUser() user: AuthUser) {
    return this.analyticsService.overview(user.id);
  }

  // Aberto a todos os planos (diferente de /ingestion, que é Business):
  // só informa QUANDO os dados atualizam, não controla a coleta.
  @Get('next-update')
  @ApiOperation({ summary: 'Próxima atualização dos dados (timer do sistema)' })
  async nextUpdate() {
    const status = await this.ingestionService.status();
    return {
      nextRunAt: status.nextRunAt,
      isRunning: status.isRunning,
      lastFinishedAt: status.lastRun?.finishedAt ?? null,
      lastStatus: status.lastRun?.status ?? null,
    };
  }
}
