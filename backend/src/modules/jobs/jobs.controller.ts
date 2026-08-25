import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { JobsService } from './jobs.service';

/** Progresso global: o que está rodando em background para este usuário. */
@ApiTags('jobs')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('ativos')
  @ApiOperation({ summary: 'Trabalhos de IA em andamento ou recém-terminados' })
  ativos(@CurrentUser() user: AuthUser) {
    return this.jobs.listarAtivos(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Estado de um trabalho (com o resultado, se terminou)' })
  obter(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.obter(user.id, id);
  }

  @Post(':id/dispensar')
  @HttpCode(204)
  @ApiOperation({ summary: 'Tira um trabalho terminado do indicador' })
  dispensar(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.dispensar(user.id, id);
  }
}
