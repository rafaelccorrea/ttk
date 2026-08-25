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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SingleFlightInterceptor } from '../../common/interceptors/single-flight.interceptor';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import { catalogoDeModelos } from '../videogen/modelos-de-video';
import { CampaignsService } from './campaigns.service';
import { JobsService } from '../jobs/jobs.service';
import {
  CloneCampaignDto,
  CreateCampaignDto,
  CreatePersonaDto,
  CreatePersonaFromPhotoDto,
  CreateUserProductDto,
  UpdateCampaignDto,
  UpdatePersonaDto,
  UpdateSceneDto,
} from './dto/campaigns.dto';

/**
 * Campanhas é recurso do Pro, e o gate precisa estar aqui.
 *
 * As etapas de IA se defendiam sozinhas pelo `ACTION_MIN_PLAN` de dentro do
 * `charge`, mas todo o resto do módulo — criar campanha, cadastrar produto,
 * montar persona, editar cena, o polling de status — rodava em conta `free`,
 * que pelo paywall é conta com pagamento pendente. `campaigns` acompanha
 * `ai_videos` porque é exatamente esse o custo por trás do produto.
 */
@ApiTags('campaigns')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
/*
 * A porta da Fábrica é o MODO AMOSTRA (free): entrar, cadastrar produto,
 * roteirizar e gerar UMA cena de produto pelo vídeo de cortesia. O que produz
 * a campanha inteira — gerar tudo, montar, clonar, redublar — pede `campaigns`
 * (Pro) endpoint a endpoint; a cena avulsa é decidida no serviço, porque a
 * regra depende da cena (só produto) e do voucher (só enquanto existe).
 */
@RequiresPlanFeature('campaigns_sample')
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly jobs: JobsService,
  ) {}

  // -------------------------------------------------------------- referência
  @Get('video-models')
  @ApiOperation({ summary: 'Modelos de vídeo disponíveis e o padrão por perfil de cena' })
  videoModels() {
    return catalogoDeModelos();
  }

  @Get('persona-options')
  @ApiOperation({ summary: 'Atributos disponíveis para montar a persona' })
  personaOptions() {
    return this.campaigns.opcoesDePersona();
  }

  @Get('pricing')
  @ApiOperation({ summary: 'Custo em créditos de cada etapa' })
  pricing(@Query('durationSeconds') duration?: string) {
    return this.campaigns.precos(Number(duration) || 15);
  }

  /*
   * ---------------------------------------------------------------- produtos
   *
   * O cadastro de produto do vendedor mora aqui por histórico, mas não é
   * exclusivo das campanhas: o Estúdio gera roteiro a partir dele
   * (`dto.userProductId`), e o Estúdio é Essencial. Por isso estas rotas
   * abaixam o piso da classe de volta para `studio_templates` — sem isso, o
   * gate de Pro quebraria o roteirizador de quem paga o Essencial.
   */
  @Post('products')
  @RequiresPlanFeature('studio_templates')
  @ApiOperation({ summary: 'Cadastra um produto do vendedor' })
  createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateUserProductDto) {
    return this.campaigns.criarProduto(user.id, dto);
  }

  @Get('products')
  @RequiresPlanFeature('studio_templates')
  @ApiOperation({ summary: 'Produtos do vendedor' })
  listProducts(@CurrentUser() user: AuthUser) {
    return this.campaigns.listarProdutos(user.id);
  }

  @Post('products/:id/photos')
  @RequiresPlanFeature('uploads')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Anexa uma foto do produto (vira frame das cenas)' })
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie uma imagem do produto.');
    }
    // O `mimetype` do multipart é escolhido por quem envia; quem valida de
    // verdade é a decodificação da imagem, dentro do espelhamento.
    return this.campaigns.adicionarFoto(user.id, id, file.buffer);
  }

  @Delete('products/:id/photos')
  @RequiresPlanFeature('studio_templates')
  @ApiOperation({ summary: 'Remove uma foto do produto' })
  removePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('url') url: string,
  ) {
    return this.campaigns.removerFoto(user.id, id, url);
  }

  @Delete('products/:id')
  @HttpCode(204)
  @RequiresPlanFeature('studio_templates')
  @ApiOperation({ summary: 'Remove um produto do vendedor' })
  deleteProduct(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.removerProduto(user.id, id);
  }

  // ---------------------------------------------------------------- personas
  @Post('personas')
  @UseInterceptors(SingleFlightInterceptor)
  @ApiOperation({ summary: 'Cria a persona e gera o retrato-semente (cobra créditos)' })
  createPersona(@CurrentUser() user: AuthUser, @Body() dto: CreatePersonaDto) {
    return this.campaigns.criarPersona(user.id, dto);
  }

  @Post('personas/from-photo')
  @RequiresPlanFeature('uploads')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Cria a persona a partir de uma foto de referência (sem cobrar retrato)',
  })
  createPersonaFromPhoto(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePersonaFromPhotoDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie a foto de referência do apresentador.');
    }
    return this.campaigns.criarPersonaComFoto(user.id, dto, file.buffer);
  }

  @Get('personas')
  @ApiOperation({ summary: 'Personas do vendedor' })
  listPersonas(@CurrentUser() user: AuthUser) {
    return this.campaigns.listarPersonas(user.id);
  }

  @Get('personas/:id')
  @ApiOperation({ summary: 'Atualiza o status do retrato da persona' })
  refreshPersona(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.atualizarPersona(user.id, id);
  }

  @Patch('personas/:id')
  @ApiOperation({
    summary: 'Edita a voz da persona (grátis — não mexe no retrato)',
  })
  updatePersona(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonaDto,
  ) {
    return this.campaigns.editarPersona(user.id, id, dto);
  }

  @Delete('personas/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove uma persona' })
  deletePersona(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.removerPersona(user.id, id);
  }

  // --------------------------------------------------------------- campanhas
  @Post()
  @ApiOperation({ summary: 'Cria a campanha (produto + persona)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.criarCampanha(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Campanhas do vendedor (paginado, com a foto do produto)' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    return this.campaigns.listarCampanhas(
      user.id,
      Number(page) || 1,
      Number(limit) || undefined,
      q,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Campanha com produto, persona e cenas' })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.detalharCampanha(user.id, id);
  }

  @Post(':id/clone')
  @RequiresPlanFeature('campaigns')
  @ApiOperation({ summary: 'Duplica a campanha (mesmo roteiro), opcionalmente com outro apresentador — grátis' })
  clone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloneCampaignDto,
  ) {
    return this.campaigns.clonarCampanha(user.id, id, dto);
  }

  @Post(':id/storyboard')
  @ApiOperation({ summary: 'Cria um storyboard em branco para escrever à mão — grátis' })
  manualStoryboard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.criarStoryboardManual(user.id, id);
  }

  @Post(':id/script')
  @UseInterceptors(SingleFlightInterceptor)
  @ApiOperation({ summary: 'Gera roteiro e storyboard (cobra créditos)' })
  async script(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    // Job em background: fechar a aba não perde o roteiro. A validação roda
    // antes (4xx normal); o resultado do job é o detalhe da campanha.
    const campanha = await this.campaigns.validarGeracaoDeRoteiro(user.id, id);
    const emVoo = await this.jobs.emVoo(user.id, 'campaign_script', id);
    if (emVoo) return emVoo;
    return this.jobs.iniciar(
      {
        userId: user.id,
        tipo: 'campaign_script',
        titulo: `Roteiro da campanha ${campanha.title ?? ''}`.trim(),
        referenciaId: id,
      },
      (ctx) => this.campaigns.gerarRoteiro(user.id, id, ctx),
    );
  }

  @Post(':id/assemble')
  @RequiresPlanFeature('campaigns')
  @UseInterceptors(SingleFlightInterceptor)
  @ApiOperation({ summary: 'Junta as cenas num único vídeo (não cobra créditos)' })
  async assemble(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const campanha = await this.campaigns.validarMontagem(user.id, id);
    const emVoo = await this.jobs.emVoo(user.id, 'campaign_assemble', id);
    if (emVoo) return emVoo;
    return this.jobs.iniciar(
      {
        userId: user.id,
        tipo: 'campaign_assemble',
        titulo: `Montando o vídeo final ${campanha.title ?? ''}`.trim(),
        referenciaId: id,
      },
      async (ctx) => {
        await ctx.progresso(20, 'Juntando as cenas');
        return this.campaigns.montar(user.id, id);
      },
    );
  }

  @Post(':id/render-all')
  @RequiresPlanFeature('campaigns')
  @UseInterceptors(SingleFlightInterceptor)
  @ApiOperation({
    summary: 'Renderiza todas as cenas que faltam (cobra por cena) e monta o final',
  })
  renderAll(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.renderizarTudo(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Preferências da campanha (ex.: legendas do vídeo final)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.atualizarCampanhaPreferencias(user.id, id, dto);
  }

  @Post(':id/queue/cancel')
  @ApiOperation({ summary: 'Cancela as cenas ainda não disparadas da fila (grátis)' })
  cancelQueue(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.cancelarFila(user.id, id);
  }

  @Get(':id/refresh')
  @ApiOperation({ summary: 'Atualiza o status das cenas em renderização' })
  refresh(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.atualizarCampanha(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove uma campanha' })
  delete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.removerCampanha(user.id, id);
  }

  // ------------------------------------------------------------------- cenas
  @Patch('scenes/:sceneId')
  @ApiOperation({ summary: 'Edita a fala, a ação e a foto de uma cena' })
  updateScene(
    @CurrentUser() user: AuthUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() dto: UpdateSceneDto,
  ) {
    return this.campaigns.editarCena(user.id, sceneId, dto);
  }

  @Post('scenes/:sceneId/redub')
  @RequiresPlanFeature('campaigns')
  @UseInterceptors(SingleFlightInterceptor)
  @ApiOperation({ summary: 'Regrava a narração pt-BR de uma cena pronta (não cobra créditos)' })
  redubScene(
    @CurrentUser() user: AuthUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ) {
    return this.campaigns.redublarCena(user.id, sceneId);
  }

  @Post('scenes/:sceneId/reopen')
  @ApiOperation({
    summary: 'Reabre uma cena pronta para editar e renderizar de novo (não cobra)',
  })
  reopenScene(
    @CurrentUser() user: AuthUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ) {
    return this.campaigns.reabrirCena(user.id, sceneId);
  }

  @Post('scenes/:sceneId/render')
  @UseInterceptors(SingleFlightInterceptor)
  @ApiOperation({ summary: 'Renderiza uma cena (cobra créditos)' })
  renderScene(
    @CurrentUser() user: AuthUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ) {
    return this.campaigns.renderizarCena(user.id, sceneId);
  }
}
