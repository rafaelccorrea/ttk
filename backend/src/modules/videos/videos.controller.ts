import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { QueryVideosDto } from './dto/query-videos.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Get()
  @ApiOperation({ summary: 'Vídeos virais ordenados por views' })
  list(@Query() query: QueryVideosDto, @CurrentUser() user: AuthUser) {
    return this.videosService.list(query, user.id);
  }

  @Get('sections')
  @ApiOperation({ summary: 'Vídeos agrupados por categoria (vitrine)' })
  sections(
    @CurrentUser() user: AuthUser,
    @Query('perSection') perSection?: string,
    @Query('maxSections') maxSections?: string,
  ) {
    return this.videosService.sections(
      Math.min(Number(perSection) || 12, 24),
      Math.min(Number(maxSections) || 10, 31),
      user.id,
    );
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categorias com vídeos disponíveis (para o filtro)' })
  categories() {
    return this.videosService.categories();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do vídeo com produto relacionado' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.videosService.findOne(id, user.id);
  }

  @Get(':id/playback')
  @ApiOperation({
    summary: 'Resolve o MP4 tocável do vídeo (URL temporária, ~1h)',
    description:
      'A URL assinada do CDN da TikTok expira em horas, por isso não é ' +
      'persistida. Chame este endpoint no momento de dar play.',
  })
  playback(@Param('id', ParseUUIDPipe) id: string) {
    return this.videosService.resolvePlayback(id);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Alterna vídeo salvo para o usuário' })
  toggleSave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.videosService.toggleSave(user.id, id);
  }
}
