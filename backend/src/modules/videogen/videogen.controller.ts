import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SingleFlightInterceptor } from '../../common/interceptors/single-flight.interceptor';
import { GenerateMediaDto } from './dto/generate-media.dto';
import { VideogenService } from './videogen.service';

@ApiTags('videogen')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('videogen')
export class VideogenController {
  constructor(private readonly videogenService: VideogenService) {}

  @Post()
  @UseInterceptors(SingleFlightInterceptor)
  @ApiOperation({ summary: 'Gera imagem ou vídeo por IA (Higgsfield)' })
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateMediaDto) {
    return this.videogenService.generate(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Gerações do usuário' })
  list(@CurrentUser() user: AuthUser) {
    return this.videogenService.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Atualiza e retorna o status de uma geração' })
  refresh(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videogenService.refresh(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove uma geração do usuário' })
  delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videogenService.delete(user.id, id);
  }
}
