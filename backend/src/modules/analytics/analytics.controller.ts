import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { IngestionService } from '../ingestion/ingestion.service';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly ingestionService: IngestionService,
  ) {}

  @Get('overview')
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
