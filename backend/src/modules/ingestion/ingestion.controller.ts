import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ApiQuotaService } from './api-quota.service';
import { IngestionService } from './ingestion.service';
import { VitrineAuditService } from './vitrine-audit.service';

@ApiTags('ingestion')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
@RequiresPlanFeature('ingestion')
@Controller('ingestion')
export class IngestionController {
  constructor(
    private readonly ingestionService: IngestionService,
    private readonly quota: ApiQuotaService,
    private readonly audit: VitrineAuditService,
  ) {}

  @Post('run')
  @ApiOperation({ summary: 'Executa a ingestão agora (manual)' })
  run() {
    return this.ingestionService.run('manual');
  }

  @Get('quota')
  @ApiOperation({
    summary: 'Consumo da cota do fornecedor no mês, por finalidade',
  })
  quotaStatus() {
    return this.quota.situacao();
  }

  @Get('vitrine-audit')
  @ApiOperation({
    summary: 'Ausculta a vitrine: card mudo, vídeo sem receita, sem preço…',
  })
  vitrineAudit() {
    return this.audit.auditar();
  }

  @Get('status')
  @ApiOperation({ summary: 'Status: agendamento, próxima execução e última execução' })
  status() {
    return this.ingestionService.status();
  }

  @Get('runs')
  @ApiOperation({ summary: 'Histórico de execuções' })
  runs(@Query('limit') limit?: string) {
    return this.ingestionService.listRuns(Math.min(Number(limit) || 20, 100));
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Configuração do agendamento' })
  schedule() {
    return this.ingestionService.getSchedule();
  }

  @Patch('schedule')
  @ApiOperation({ summary: 'Atualiza cron/ativação do agendamento' })
  updateSchedule(@Body() dto: UpdateScheduleDto) {
    return this.ingestionService.updateSchedule(dto);
  }
}
