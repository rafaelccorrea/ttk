import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ApiQuotaService } from './api-quota.service';
import { IngestionService } from './ingestion.service';
import { VitrineAuditService } from './vitrine-audit.service';
import { UserThrottlerGuard } from '../../common/throttler/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import { LIMITE_OPERACAO } from '../../common/throttler/limites';

/**
 * Coleta do fornecedor (EchoTik): ADMINISTRAÇÃO, não recurso de plano.
 *
 * Antes a porta era `@RequiresPlanFeature('ingestion')`, e o efeito não era o
 * que o nome sugere: qualquer conta Business — todo cliente do plano mais caro,
 * mais toda conta de cortesia — podia desligar o agendamento global de
 * scraping, reescrever o cron ou disparar ingestão manual em rajada contra a
 * cota mensal que nós pagamos. Nada aqui é do usuário: é um único estado
 * compartilhado por toda a plataforma, e derrubá-lo trava o catálogo de todo
 * mundo. Guard de plano responde "você pagou o suficiente?"; a pergunta certa
 * era "você é da casa?".
 *
 * A checagem de plano sai de cena de propósito, e não vira uma segunda camada:
 * administração não é assunto de assinatura, e exigir plano de um administrador
 * quebraria a área justamente quando ela é mais necessária — uma conta de
 * operação sem assinatura ativa. O `FEATURE_MIN_PLAN.ingestion` continua no
 * lugar porque é o que o `PlanGate` do frontend usa para esconder a tela; quem
 * barra de verdade é o `AdminGuard`, aqui.
 */
@ApiTags('ingestion')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, AdminGuard, UserThrottlerGuard)
@Controller('ingestion')
export class IngestionController {
  constructor(
    private readonly ingestionService: IngestionService,
    private readonly quota: ApiQuotaService,
    private readonly audit: VitrineAuditService,
  ) {}

  @Throttle(LIMITE_OPERACAO)
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

  @Throttle(LIMITE_OPERACAO)
  @Patch('schedule')
  @ApiOperation({ summary: 'Atualiza cron/ativação do agendamento' })
  updateSchedule(@Body() dto: UpdateScheduleDto) {
    return this.ingestionService.updateSchedule(dto);
  }
}
