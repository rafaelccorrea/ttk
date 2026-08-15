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

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do vídeo com produto relacionado' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.videosService.findOne(id, user.id);
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
