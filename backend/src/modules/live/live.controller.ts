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
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import {
  AtualizarFaqDto,
  AtualizarProdutoDto,
  CriarFaqDto,
  CriarLiveSessionDto,
  CriarProdutoDto,
} from './dto/live.dto';
import { LiveService } from './live.service';

/**
 * Teto do upload da gravação.
 *
 * Uma live de 4h em MP4 na qualidade que o TikTok entrega passa de 1GB. Com o
 * upload indo para DISCO (ver `PASTA_DE_UPLOAD` abaixo) este número é limite de
 * espaço temporário, não de RAM. 2GB cobre a live longa com folga; acima disso
 * o caminho certo é cortar a gravação em partes.
 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * O upload é gravado em disco, nunca no heap.
 *
 * O `memoryStorage` (padrão do Multer quando não se passa `dest`) segurava os
 * 2GB do arquivo num `Buffer` — e não só durante a request: o pipeline roda em
 * background e mantinha o mesmo buffer vivo pelas dezenas de minutos da
 * transcrição. Três vendedores enviando lives longas ao mesmo tempo estouravam
 * o heap e derrubavam a API inteira, junto com todas as sessões em andamento.
 * Com `dest`, o Multer escreve direto no disco e o processo só vê o caminho; a
 * remoção do arquivo é do pipeline, que é quem sabe quando terminou de usá-lo.
 */
const PASTA_DE_UPLOAD = join(tmpdir(), 'pikpok-live-uploads');
mkdirSync(PASTA_DE_UPLOAD, { recursive: true });

/**
 * O que o pipeline sabe abrir. Só o prefixo é checado porque o container varia
 * demais (mp4, mov, mkv, webm, ogg, m4a) e quem decide de verdade se o arquivo
 * é legível é o ffmpeg, na extração — isto aqui é a peneira barata que impede
 * um PDF ou um ZIP de chegar até lá.
 */
const PREFIXOS_ACEITOS = ['video/', 'audio/'];

/**
 * Teto do CSV de catálogo.
 *
 * Quinhentos produtos com todos os campos preenchidos dão algo perto de 100KB.
 * Dois megabytes é a folga para planilha exportada com lixo de formatação — e
 * ainda assim pequeno o bastante para o arquivo caber em memória sem risco.
 */
const MAX_CSV_BYTES = 2 * 1024 * 1024;

@ApiTags('live')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
@RequiresPlanFeature('live_copilot')
@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  // ---------------------------------------------------------------- sessões
  @Post('sessions')
  @ApiOperation({ summary: 'Cria a sessão de live (base de conhecimento vazia)' })
  createSession(@CurrentUser() user: AuthUser, @Body() dto: CriarLiveSessionDto) {
    return this.live.criarSessao(user.id, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Lives do vendedor' })
  listSessions(@CurrentUser() user: AuthUser) {
    return this.live.listarSessoes(user.id);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Live com produtos e FAQ (é por aqui que a tela faz polling do status)' })
  getSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.live.obterSessao(user.id, id);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a live e a base de conhecimento dela' })
  deleteSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.live.apagarSessao(user.id, id);
  }

  @Post('sessions/:id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: PASTA_DE_UPLOAD,
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  @ApiOperation({
    summary: 'Envia a gravação e dispara a extração (cobra créditos; responde na hora, em "transcrevendo")',
  })
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file: Express.Multer.File,
  ) {
    // O `mimetype` do multipart é declarado por quem envia e não prova nada —
    // é filtro de conveniência. A validação real vem do ffmpeg conseguindo (ou
    // não) demuxar o arquivo, e o erro dele vira o `errorMessage` da sessão.
    const mimetype = file?.mimetype ?? '';
    if (!PREFIXOS_ACEITOS.some((p) => mimetype.startsWith(p))) {
      // O arquivo já está em disco quando chegamos aqui: recusar sem apagar
      // deixaria gigabytes de lixo no tmp a cada tentativa errada.
      if (file?.path) void unlink(file.path).catch(() => undefined);
      throw new BadRequestException(
        'Envie a gravação da live em vídeo ou áudio (mp4, mov, mkv, m4a, mp3...).',
      );
    }
    return this.live.processarUpload(user.id, id, file);
  }

  // --------------------------------------------------------------- produtos
  /**
   * Importa o catálogo de uma planilha CSV.
   *
   * Fica em memória (`FileInterceptor` sem `dest`) porque um catálogo de 500
   * itens não passa de algumas dezenas de KB — o teto de 2MB aqui é folga para
   * planilha mal exportada, não expectativa. Nada a ver com o upload da
   * gravação, que são gigabytes e por isso vai para disco.
   */
  @Post('sessions/:id/products/import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_CSV_BYTES } }),
  )
  @ApiOperation({
    summary: 'Importa produtos de um CSV para a base (atualiza os que já existem)',
  })
  importarCatalogo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_CSV_BYTES })],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie a planilha em CSV.');
    }
    return this.live.importarCatalogo(user.id, id, file.buffer);
  }

  @Post('sessions/:id/products')
  @ApiOperation({ summary: 'Acrescenta um produto à base à mão' })
  createProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CriarProdutoDto,
  ) {
    return this.live.criarProduto(user.id, id, dto);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Corrige um produto da base' })
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarProdutoDto,
  ) {
    return this.live.atualizarProduto(user.id, id, dto);
  }

  @Delete('products/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um produto da base' })
  deleteProduct(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.live.apagarProduto(user.id, id);
  }

  // -------------------------------------------------------------------- FAQ
  @Post('sessions/:id/faq')
  @ApiOperation({ summary: 'Acrescenta uma resposta, objeção ou política à mão' })
  createFaq(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CriarFaqDto,
  ) {
    return this.live.criarFaq(user.id, id, dto);
  }

  @Patch('faq/:id')
  @ApiOperation({ summary: 'Corrige uma resposta da base' })
  updateFaq(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarFaqDto,
  ) {
    return this.live.atualizarFaq(user.id, id, dto);
  }

  @Delete('faq/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove uma resposta da base' })
  deleteFaq(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.live.apagarFaq(user.id, id);
  }
}
