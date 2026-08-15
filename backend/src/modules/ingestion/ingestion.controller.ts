import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { IngestionService } from './ingestion.service';

@ApiTags('ingestion')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('run')
  @ApiOperation({ summary: 'Executa a ingestão de tendências agora (também roda 1x/dia via cron)' })
  run() {
    return this.ingestionService.run();
  }

  @Get('status')
  @ApiOperation({ summary: 'Resultado da última execução da ingestão' })
  status() {
    return this.ingestionService.status();
  }
}
