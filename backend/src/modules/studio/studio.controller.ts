import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { GenerateScriptDto } from './dto/generate-script.dto';
import { StudioService } from './studio.service';

@ApiTags('studio')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('studio')
export class StudioController {
  constructor(private readonly studioService: StudioService) {}

  @Post('scripts/generate')
  @ApiOperation({ summary: 'Gera um roteiro de live ou vídeo com IA' })
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateScriptDto) {
    return this.studioService.generate(user.id, dto);
  }

  @Get('scripts')
  @ApiOperation({ summary: 'Roteiros salvos do usuário' })
  listScripts(@CurrentUser() user: AuthUser) {
    return this.studioService.listScripts(user.id);
  }

  @Delete('scripts/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um roteiro do usuário' })
  deleteScript(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.studioService.deleteScript(user.id, id);
  }

  @Get('prompts')
  @ApiOperation({ summary: 'Cofre de prompts (filtros: mediaType, niche, search)' })
  listPrompts(
    @Query('mediaType') mediaType?: 'video' | 'image',
    @Query('niche') niche?: string,
    @Query('search') search?: string,
  ) {
    return this.studioService.listPrompts({ mediaType, niche, search });
  }
}
