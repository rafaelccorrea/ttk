import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import { CreateStoreDto } from './dto/create-store.dto';
import {
  QueryPeriodDto,
  QueryStoreOrdersDto,
  QueryStoreProductsDto,
} from './dto/query-store.dto';
import { SimulatePricingDto } from './dto/simulate-pricing.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { UpdateStoreProductDto } from './dto/update-store-product.dto';
import {
  STORE_DATASETS,
  StoreDataset,
} from './sources/store-sync-source';
import { StoresAnalyticsService } from './stores-analytics.service';
import { ExportFile, StoresExportService } from './stores-export.service';
import { StoresImportService } from './stores-import.service';
import { StoresService } from './stores.service';

/** Limite do arquivo importado — relatórios do Seller Center ficam bem abaixo. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@ApiTags('stores')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
@RequiresPlanFeature('stores')
@Controller('stores')
export class StoresController {
  constructor(
    private readonly stores: StoresService,
    private readonly imports: StoresImportService,
    private readonly analytics: StoresAnalyticsService,
    private readonly exports: StoresExportService,
  ) {}

  // ----------------------------------------------------------------- Lojas

  @Post()
  @ApiOperation({ summary: 'Cadastra uma loja do usuário' })
  create(@Body() dto: CreateStoreDto, @CurrentUser() user: AuthUser) {
    return this.stores.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista as lojas do usuário' })
  list(@CurrentUser() user: AuthUser) {
    return this.stores.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da loja' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stores.owned(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza dados e parâmetros fiscais da loja' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stores.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a loja e todos os dados importados' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stores.remove(user.id, id);
  }

  // ----------------------------------------------------------- Importação

  @Post(':id/imports/:dataset')
  @ApiOperation({
    summary:
      'Importa um relatório CSV exportado do Seller Center (produtos, pedidos ou repasses)',
  })
  @ApiParam({ name: 'dataset', enum: STORE_DATASETS })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  importDataset(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dataset') dataset: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!STORE_DATASETS.includes(dataset as StoreDataset)) {
      throw new BadRequestException(
        `Relatório inválido. Use: ${STORE_DATASETS.join(', ')}.`,
      );
    }
    if (!file) {
      throw new BadRequestException('Envie o arquivo no campo "file".');
    }
    return this.imports.import(user.id, id, dataset as StoreDataset, {
      buffer: file.buffer,
      originalName: file.originalname,
    });
  }

  @Get(':id/imports')
  @ApiOperation({ summary: 'Histórico de importações da loja' })
  listImports(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stores.listImports(user.id, id);
  }

  // -------------------------------------------------------------- Catálogo

  @Get(':id/products')
  @ApiOperation({ summary: 'Catálogo da loja com custo, margem e ruptura' })
  listProducts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryStoreProductsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stores.listProducts(user.id, id, query);
  }

  @Patch(':id/products/:productId')
  @ApiOperation({ summary: 'Atualiza custo, preço ou alerta de estoque do SKU' })
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateStoreProductDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stores.updateProduct(user.id, id, productId, dto);
  }

  // --------------------------------------------------------------- Pedidos

  @Get(':id/orders')
  @ApiOperation({ summary: 'Pedidos importados, com SLA de envio' })
  listOrders(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryStoreOrdersDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stores.listOrders(user.id, id, query);
  }

  // ------------------------------------------------------------- Analytics

  @Get(':id/overview')
  @ApiOperation({ summary: 'Faturamento, taxas, lucro estimado e operação' })
  overview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryPeriodDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.analytics.overview(user.id, id, query.period ?? 30);
  }

  @Get(':id/skus')
  @ApiOperation({ summary: 'Desempenho por SKU com curva ABC e margem' })
  skus(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryPeriodDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.analytics.skuPerformance(user.id, id, query.period ?? 30);
  }

  @Get(':id/opportunities')
  @ApiOperation({
    summary: 'Cruza o catálogo da loja com o radar de produtos em alta',
  })
  opportunities(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryPeriodDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.analytics.opportunities(user.id, id, query.period ?? 30);
  }

  // ----------------------------------------------------------- Exportação

  @Get(':id/products/export')
  @ApiOperation({ summary: 'Baixa o catálogo com custo e margem em CSV' })
  async exportProducts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sendCsv(res, await this.exports.products(user.id, id));
  }

  @Get(':id/skus/export')
  @ApiOperation({ summary: 'Baixa a curva ABC com margem por SKU em CSV' })
  async exportSkus(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryPeriodDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sendCsv(
      res,
      await this.exports.skus(user.id, id, query.period ?? 30),
    );
  }

  @Get(':id/orders/export')
  @ApiOperation({ summary: 'Baixa os pedidos do período em CSV' })
  async exportOrders(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryPeriodDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sendCsv(
      res,
      await this.exports.orders(user.id, id, query.period ?? 30),
    );
  }

  private sendCsv(res: Response, file: ExportFile): StreamableFile {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    return new StreamableFile(Buffer.from(file.content, 'utf8'));
  }

  // ----------------------------------------------------------- Precificação

  @Post(':id/pricing/simulate')
  @ApiOperation({ summary: 'Calcula margem, ponto de equilíbrio e preço sugerido' })
  simulatePricing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SimulatePricingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stores.simulatePricing(user.id, id, dto);
  }
}
