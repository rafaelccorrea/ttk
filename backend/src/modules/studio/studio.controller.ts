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
import {
  TRANSCRIBE_MAX_MINUTES,
  transcribeBlocks,
} from '../billing/billing.config';
import { BillingService } from '../billing/billing.service';
import { JobsService } from '../jobs/jobs.service';
import { VideoAssemblyService } from '../campaigns/video-assembly.service';
import { AnalyzeDto } from './dto/analyze.dto';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { SingleFlightInterceptor } from '../../common/interceptors/single-flight.interceptor';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import { PromptRefreshService } from './prompt-refresh.service';
import { StudioService } from './studio.service';
import { TranscriptionService } from './transcription.service';
import { limiteDeUpload } from '../../common/uploads';
import { UserThrottlerGuard } from '../../common/throttler/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import {
  LIMITE_IA,
  LIMITE_IA_PESADA,
  LIMITE_OPERACAO,
  LIMITE_UPLOAD,
} from '../../common/throttler/limites';

/** Limite do Whisper para o arquivo enviado. */
const MAX_TRANSCRICAO_BYTES = 25 * 1024 * 1024;
/** Foto do produto que vai junto no prompt do roteirizador. */
const MAX_FOTO_BYTES = 10 * 1024 * 1024;


/**
 * O Estúdio inteiro é de plano pago.
 *
 * O gate de recurso ficava só dentro do `charge`, o que protegia as chamadas de
 * IA mas deixava passar tudo que não cobra: o upload da foto do produto (10MB
 * no nosso bucket) e a leitura do Cofre de Prompts — um catálogo que nós
 * geramos com Claude e pagamos para manter. Conta `free` é conta com pagamento
 * pendente; aqui ela não entra.
 *
 * `studio_templates` (Essencial) é o piso: cada rota mais cara se declara
 * sozinha abaixo, e o `getAllAndOverride` do guard faz o handler vencer.
 */
@ApiTags('studio')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard, UserThrottlerGuard)
@RequiresPlanFeature('studio_templates')
@Controller('studio')
export class StudioController {
  constructor(
    private readonly studioService: StudioService,
    private readonly transcriptionService: TranscriptionService,
    private readonly billing: BillingService,
    private readonly promptRefresh: PromptRefreshService,
    private readonly jobs: JobsService,
    // Só pela leitura de duração do arquivo enviado — é o único lugar do
    // projeto que já sabe conversar com o ffmpeg.
    private readonly assembly: VideoAssemblyService,
  ) {}

  /**
   * O preço acompanha a DURAÇÃO, não o tamanho do arquivo.
   *
   * O Whisper cobra por minuto e o limite do upload é em MB — duas grandezas
   * que não se correspondem. Com o preço fixo antigo (12 créditos por "até
   * 25MB ≈ 20 min"), 25MB de áudio a 64kbps eram ~52 minutos de processamento:
   * R$ 1,88 de custo contra R$ 1,20 cobrados. O arquivo mais leve de enviar era
   * o mais caro de atender.
   */
  @Throttle(LIMITE_IA_PESADA)
  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('file', limiteDeUpload(MAX_TRANSCRICAO_BYTES)),
    SingleFlightInterceptor,
  )
  @ApiOperation({
    summary: 'Transcreve um vídeo/áudio (Whisper, máx. 25MB; cobra por 10 min)',
  })
  async transcribe(
    @CurrentUser() user: AuthUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_TRANSCRICAO_BYTES })],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie um arquivo de vídeo ou áudio.');
    }

    const segundos = await this.assembly.duracaoDoBuffer(
      file.buffer,
      file.originalname,
    );
    // Sem duração não há como precificar, e cobrar um valor fixo é justamente o
    // furo que se está fechando — então o pedido para aqui em vez de virar uma
    // chamada de custo desconhecido.
    if (segundos === null) {
      throw new BadRequestException(
        'Não foi possível ler a duração deste arquivo. Envie um MP4, MP3 ou M4A válido.',
      );
    }
    if (segundos / 60 > TRANSCRIBE_MAX_MINUTES) {
      throw new BadRequestException(
        `O arquivo tem ${Math.round(segundos / 60)} minutos, acima do limite de ${TRANSCRIBE_MAX_MINUTES}. Corte o trecho que interessa e envie de novo.`,
      );
    }

    const blocos = transcribeBlocks(segundos);
    // Whisper custa dinheiro real → cobra créditos; estorna se a API falhar.
    // Roda como job em background: fechar a aba não mata a transcrição — a
    // tela reconecta pelo progresso global e lê `resultado.transcript`.
    const { buffer, originalname, mimetype } = file;
    return this.jobs.iniciar(
      {
        userId: user.id,
        tipo: 'transcribe',
        titulo: `Transcrevendo ${originalname || 'vídeo'}`,
      },
      async (ctx) => {
        await ctx.progresso(10, 'Ouvindo o áudio');
        return this.billing.withCharge(
          user.id,
          'transcribe',
          async () => {
            await ctx.cobrado('transcribe', blocos);
            return this.transcriptionService.transcribe({
              buffer,
              originalname,
              mimetype,
            } as Express.Multer.File);
          },
          blocos,
        );
      },
    );
  }

  @Throttle(LIMITE_UPLOAD)
  @Post('product-image')
  @RequiresPlanFeature('uploads')
  @UseInterceptors(FileInterceptor('file', limiteDeUpload(MAX_FOTO_BYTES)))
  @ApiOperation({
    summary: 'Envia a foto do produto que o roteirizador manda para a IA ver',
  })
  productImage(
    @CurrentUser() user: AuthUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_FOTO_BYTES })],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie uma imagem do produto.');
    }
    // O `mimetype` do multipart é escolhido por quem envia; quem valida de
    // verdade é a decodificação da imagem, dentro do espelhamento.
    return this.studioService.salvarFotoDoProduto(user.id, file.buffer);
  }

  @UseInterceptors(SingleFlightInterceptor)
  @Throttle(LIMITE_IA)
  @Post('analyze')
  @ApiOperation({
    summary: 'Decompõe a transcrição de um vídeo viral e adapta ao produto',
  })
  analyze(@CurrentUser() user: AuthUser, @Body() dto: AnalyzeDto) {
    // Job em background (resultado = Script salvo). Ver `transcribe`.
    return this.jobs.iniciar(
      { userId: user.id, tipo: 'analyze', titulo: 'Analisando vídeo viral' },
      async (ctx) => {
        await ctx.progresso(15, 'Decompondo o roteiro');
        return this.studioService.analyze(
          user.id,
          dto.transcript,
          dto.productId,
          dto.userProductId,
          ctx,
        );
      },
    );
  }

  @UseInterceptors(SingleFlightInterceptor)
  @Throttle(LIMITE_IA)
  @Post('scripts/generate')
  @ApiOperation({ summary: 'Gera um roteiro de live ou vídeo com IA' })
  async generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateScriptDto) {
    // A validação (produto existe, conteúdo permitido) acontece ANTES de
    // criar o job, para o erro voltar como 4xx e não como job falhado.
    const preparado = await this.studioService.prepararGeracao(user.id, dto);
    return this.jobs.iniciar(
      {
        userId: user.id,
        tipo: 'script',
        titulo: `Roteiro: ${preparado.productName || (dto.type === 'live' ? 'live' : 'vídeo')}`,
      },
      async (ctx) => {
        await ctx.progresso(15, 'Escrevendo o roteiro');
        return this.studioService.generate(user.id, dto, preparado, ctx);
      },
    );
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

  @Get('prompts/refresh/status')
  @ApiOperation({ summary: 'Quando o Cofre foi/será atualizado' })
  refreshStatus() {
    return this.promptRefresh.status();
  }

  /**
   * Gatilho manual, para não depender de esperar a segunda-feira ao publicar
   * uma safra nova. Fica atrás do mesmo `RequiresPlanFeature('ingestion')` da
   * coleta de dados: é a mesma classe de operação (rodar um job caro que
   * altera o catálogo de todo mundo) e o mesmo público — sem isso, qualquer
   * conta grátis dispararia N chamadas ao Claude por clique.
   */
  @Throttle(LIMITE_OPERACAO)
  @Post('prompts/refresh')
  @RequiresPlanFeature('ingestion')
  @ApiOperation({ summary: 'Atualiza o Cofre de Prompts agora (manual)' })
  refreshNow() {
    return this.promptRefresh.run('manual');
  }
}
