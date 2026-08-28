import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { PlanFeatureGuard, RequiresPlanFeature } from '../billing/plan-feature.guard';
import { CutsService } from './cuts.service';
import { CreateCutJobDto, CreateCutJobFromUrlDto } from './dto/create-cut-job.dto';
import { LIMITES } from './cut-planner';
import { UserThrottlerGuard } from '../../common/throttler/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import {
  LIMITE_IA,
  LIMITE_IA_PESADA,
} from '../../common/throttler/limites';

/** Mesmo teto do Live Copilot: 60 min em 1080p cabem com folga. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Upload em DISCO, nunca no heap — ver a nota em live.controller.ts. */
const PASTA_DE_UPLOAD = join(tmpdir(), 'pikpok-cuts-uploads');
mkdirSync(PASTA_DE_UPLOAD, { recursive: true });

/**
 * Cortes é recurso de plano (Pro+) e cada corte é cobrado em crédito. O gate
 * fica no controller inteiro: o upload ocupa disco e o pipeline ocupa ffmpeg,
 * os dois pagos por nós antes de qualquer crédito ser debitado.
 */
@ApiTags('cuts')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard, UserThrottlerGuard)
@RequiresPlanFeature('cuts')
@Controller('cuts')
export class CutsController {
  constructor(private readonly cuts: CutsService) {}

  @Get('capabilities')
  @ApiOperation({ summary: 'O que este servidor oferece (import por link, seguir rosto)' })
  capabilities() {
    return this.cuts.capacidades();
  }

  @Get('url-info')
  @ApiOperation({ summary: 'Título, duração e capa de um link antes de confirmar' })
  urlInfo(@Query('url') url?: string) {
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new BadRequestException('Cole o link completo do vídeo (começando com https://).');
    }
    return this.cuts.inspecionarLink(url.trim());
  }

  @Throttle(LIMITE_IA_PESADA)
  @Post('from-url')
  @ApiOperation({ summary: 'Cria o job a partir de um link (YouTube); baixa no pipeline' })
  createFromUrl(@CurrentUser() user: AuthUser, @Body() dto: CreateCutJobFromUrlDto) {
    return this.cuts.criarPorUrl(user.id, dto);
  }

  @Get('quote')
  @ApiOperation({ summary: 'Estimativa de créditos antes de enviar o vídeo' })
  quote(
    @Query('mode') mode: string,
    @Query('quantity') quantity: string,
    @Query('durationSeconds') durationSeconds?: string,
  ) {
    if (mode !== 'rapido' && mode !== 'inteligente') {
      throw new BadRequestException('Modo inválido: use rapido ou inteligente.');
    }
    const qtd = Number(quantity);
    if (!Number.isInteger(qtd) || qtd < LIMITES.qtdMin || qtd > LIMITES.qtdMax) {
      throw new BadRequestException(
        `Quantidade inválida: de ${LIMITES.qtdMin} a ${LIMITES.qtdMax} cortes.`,
      );
    }
    const dur = durationSeconds ? Number(durationSeconds) : undefined;
    return this.cuts.cotar(mode, qtd, Number.isFinite(dur) ? dur : undefined);
  }

  @Get()
  @ApiOperation({ summary: 'Lista os jobs de cortes do usuário' })
  list(@CurrentUser() user: AuthUser) {
    return this.cuts.listar(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Job com os cortes (a tela faz polling enquanto processa)' })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cuts.detalhe(user.id, id);
  }

  @Throttle(LIMITE_IA_PESADA)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      dest: PASTA_DE_UPLOAD,
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  @ApiOperation({
    summary: 'Envia o vídeo e cria o job (responde na hora; cobra no pipeline)',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCutJobDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file: Express.Multer.File,
  ) {
    // O mimetype é declarado por quem envia; a validação real é o ffmpeg no
    // pipeline. Aqui é só o filtro de conveniência contra arquivo errado.
    if (!(file?.mimetype ?? '').startsWith('video/')) {
      if (file?.path) void unlink(file.path).catch(() => undefined);
      throw new BadRequestException('Envie um arquivo de VÍDEO (mp4, mov, mkv ou webm).');
    }
    return this.cuts.criar(user.id, dto, file);
  }

  @Throttle(LIMITE_IA)
  @Post('clips/:clipId/multiplier')
  @ApiOperation({
    summary: 'Manda um corte pronto para o Multiplicador como gancho, corpo ou CTA',
  })
  toMultiplier(
    @CurrentUser() user: AuthUser,
    @Param('clipId', ParseUUIDPipe) clipId: string,
    @Body() body: { role?: string; produto?: string },
  ) {
    const role = body?.role;
    if (role !== 'hook' && role !== 'body' && role !== 'cta') {
      throw new BadRequestException('Bloco inválido: use hook, body ou cta.');
    }
    const produto = typeof body?.produto === 'string' ? body.produto.trim() : undefined;
    return this.cuts.enviarParaMultiplicador(user.id, clipId, role, produto || undefined);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cancela um job em processamento; o que não foi gerado é estornado' })
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.cuts.cancelar(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Apaga o job, os cortes e os arquivos no armazenamento' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.cuts.apagar(user.id, id);
  }
}
