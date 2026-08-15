import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { IngestionService } from './ingestion.service';

@ApiTags('ingestion')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('run')
  @ApiOperation({ summary: 'Executa a ingestão agora (manual)' })
  run() {
    return this.ingestionService.run('manual');
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
