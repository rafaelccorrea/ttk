import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseFilePipe,
  MaxFileSizeValidator,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { BillingService } from '../billing/billing.service';
import { AnalyzeDto } from './dto/analyze.dto';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { StudioService } from './studio.service';
import { TranscriptionService } from './transcription.service';

@ApiTags('studio')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('studio')
export class StudioController {
  constructor(
    private readonly studioService: StudioService,
    private readonly transcriptionService: TranscriptionService,
    private readonly billing: BillingService,
  ) {}

  @Post('transcribe')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Transcreve um vídeo/áudio (Whisper, máx. 25MB)' })
  transcribe(
    @CurrentUser() user: AuthUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 25 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie um arquivo de vídeo ou áudio.');
    }
    // Whisper custa dinheiro real → cobra créditos; estorna se a API falhar.
    return this.billing.withCharge(user.id, 'transcribe', () =>
      this.transcriptionService.transcribe(file),
    );
  }

  @Post('analyze')
  @ApiOperation({
    summary: 'Decompõe a transcrição de um vídeo viral e adapta ao produto',
  })
  analyze(@CurrentUser() user: AuthUser, @Body() dto: AnalyzeDto) {
    return this.studioService.analyze(user.id, dto.transcript, dto.productId);
  }

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
