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
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
@RequiresPlanFeature('multiplier')
@Controller('combinations')
export class CombinationsController {
  constructor(private readonly combinationsService: CombinationsService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um plano de combinações Gancho × Corpo × CTA' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    return this.combinationsService.create(user.id, dto);
  }

  @Post('clips')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Envia um clipe de vídeo (gancho, corpo ou CTA)' })
  uploadClip(
    @CurrentUser() user: AuthUser,
    @Query('role') role: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 40 * 1024 * 1024 })],
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
    );
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

  @Post(':id/render')
  @ApiOperation({ summary: 'Monta em vídeo todas as combinações do plano' })
  render(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.render(user.id, id);
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
