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
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClipRole } from './entities/combination-clip.entity';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import { CombinationsService } from './combinations.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdateClipDto } from './dto/update-clip.dto';
import { FolderDto, MoveVideosDto } from './dto/folder.dto';
import { BulkVideoResultDto, VideoResultDto } from './dto/video-result.dto';
import { limiteDeUpload } from '../../common/uploads';
import { UserThrottlerGuard } from '../../common/throttler/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import {
  LIMITE_IA,
  LIMITE_IA_PESADA,
  LIMITE_UPLOAD,
} from '../../common/throttler/limites';

/** Clipe de gancho/corpo/CTA: são cortes de poucos segundos. */
const MAX_CLIPE_BYTES = 40 * 1024 * 1024;


/**
 * O multiplicador é recurso de plano pago, e o gate precisa estar AQUI.
 *
 * Esconder a tela no front não protege nada: o upload guarda MP4 no bucket e a
 * montagem gasta CPU de ffmpeg, os dois pagos por nós. Sem este guard qualquer
 * conta autenticada — inclusive `free` — chamava `POST /combinations/:id/render`
 * direto e consumia servidor de graça.
 */
@ApiTags('combinations')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard, UserThrottlerGuard)
@RequiresPlanFeature('multiplier')
@Controller('combinations')
export class CombinationsController {
  constructor(private readonly combinationsService: CombinationsService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um plano de combinações Gancho × Corpo × CTA' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    return this.combinationsService.create(user.id, dto);
  }

  @Throttle(LIMITE_UPLOAD)
  @Post('clips')
  @UseInterceptors(FileInterceptor('file', limiteDeUpload(MAX_CLIPE_BYTES)))
  @ApiOperation({ summary: 'Envia um clipe de vídeo (gancho, corpo ou CTA)' })
  uploadClip(
    @CurrentUser() user: AuthUser,
    @Query('role') role: string,
    @Query('produto') produto: string | undefined,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_CLIPE_BYTES })],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!['hook', 'body', 'cta'].includes(role)) {
      throw new BadRequestException('Bloco inválido: use hook, body ou cta.');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie um arquivo de vídeo.');
    }
    return this.combinationsService.uploadClip(
      user.id,
      role as ClipRole,
      file.originalname ?? 'clipe.mp4',
      file.buffer,
      produto,
    );
  }

  @Patch('clips/:id')
  @ApiOperation({ summary: 'Edita a etiqueta de produto do clipe' })
  updateClip(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClipDto,
  ) {
    return this.combinationsService.updateClip(user.id, id, dto.produto);
  }

  @Get('clips')
  @ApiOperation({ summary: 'Clipes já enviados pelo usuário' })
  listClips(@CurrentUser() user: AuthUser) {
    return this.combinationsService.listClips(user.id);
  }

  @Delete('clips/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um clipe' })
  deleteClip(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.deleteClip(user.id, id);
  }

  // Antes de `@Delete(':id')`: sem isto o Nest casaria "videos" como um id de
  // plano e a rota nunca seria alcançada.
  @Delete('videos/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Descarta um vídeo montado (remove o arquivo também)' })
  deleteVideo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.deleteVideo(user.id, id);
  }

  // ------------------------------------------------------------- pastas
  // Todas antes de `:id`: "folders" seria lido como id de plano.

  @Get('folders')
  @ApiOperation({ summary: 'Pastas do usuário' })
  listFolders(@CurrentUser() user: AuthUser) {
    return this.combinationsService.listFolders(user.id);
  }

  @Post('folders')
  @ApiOperation({ summary: 'Cria uma pasta' })
  createFolder(@CurrentUser() user: AuthUser, @Body() dto: FolderDto) {
    return this.combinationsService.createFolder(user.id, dto.name ?? '', dto.color);
  }

  @Patch('folders/:id')
  @ApiOperation({ summary: 'Renomeia ou recolore uma pasta' })
  renameFolder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FolderDto,
  ) {
    return this.combinationsService.renameFolder(user.id, id, dto.name, dto.color);
  }

  @Delete('folders/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Apaga a pasta (os vídeos voltam para "sem pasta")' })
  deleteFolder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.deleteFolder(user.id, id);
  }

  @Post('videos/move')
  @HttpCode(204)
  @ApiOperation({ summary: 'Move vídeos para uma pasta (folderId null = tirar da pasta)' })
  moveVideos(@CurrentUser() user: AuthUser, @Body() dto: MoveVideosDto) {
    return this.combinationsService.moveVideos(
      user.id,
      dto.videoIds,
      dto.folderId ?? null,
    );
  }

  // Antes de `videos/:id/result` por clareza de leitura — "results" é rota
  // fixa e não disputa com o parâmetro, que está um segmento mais fundo.
  @Patch('videos/results')
  @ApiOperation({
    summary: 'Lança o desempenho de vários vídeos de uma vez',
  })
  setResults(@CurrentUser() user: AuthUser, @Body() dto: BulkVideoResultDto) {
    return this.combinationsService.setResultsBulk(user.id, dto.itens);
  }

  @Patch('videos/:id/result')
  @ApiOperation({
    summary: 'Lança o desempenho de um vídeo publicado (tudo opcional)',
  })
  setResult(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VideoResultDto,
  ) {
    return this.combinationsService.setResult(user.id, id, dto);
  }

  @Get('gallery')
  @ApiOperation({ summary: 'Todos os vídeos já montados pelo usuário' })
  gallery(@CurrentUser() user: AuthUser) {
    return this.combinationsService.listGallery(user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Planos de combinações do usuário' })
  list(@CurrentUser() user: AuthUser) {
    return this.combinationsService.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um plano com a matriz expandida' })
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.findOne(user.id, id);
  }

  @Throttle(LIMITE_IA_PESADA)
  @Post(':id/render')
  @ApiOperation({ summary: 'Monta em vídeo todas as combinações do plano' })
  render(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.render(user.id, id);
  }

  @Get(':id/insights')
  @ApiOperation({
    summary: 'Ranking das peças do plano pelo desempenho já lançado',
  })
  insights(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.insights(user.id, id);
  }

  @Throttle(LIMITE_IA)
  @Post(':id/derive')
  @ApiOperation({
    summary: 'Cria um plano novo só com as peças vencedoras deste',
  })
  derive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.derive(user.id, id);
  }

  @Get(':id/videos')
  @ApiOperation({ summary: 'Status dos vídeos montados do plano' })
  videos(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.listVideos(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um plano do usuário' })
  delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.delete(user.id, id);
  }
}
