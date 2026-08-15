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
import { QueryProductsDto } from './dto/query-products.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Ranking de produtos por período (7/30/90 dias)' })
  rank(@Query() query: QueryProductsDto, @CurrentUser() user: AuthUser) {
    return this.productsService.rank(query, user.id);
  }

  @Get('sections')
  @ApiOperation({
    summary: 'Catálogo agrupado por categoria (vitrine, N produtos por seção)',
  })
  sections(
    @CurrentUser() user: AuthUser,
    @Query('period') period?: string,
    @Query('perSection') perSection?: string,
    @Query('maxSections') maxSections?: string,
    @Query('offset') offset?: string,
  ) {
    return this.productsService.sections(
      Math.min(Number(period) || 30, 90),
      Math.min(Number(perSection) || 12, 24),
      // Lote pequeno: o scroll infinito pede mais conforme desce.
      Math.min(Number(maxSections) || 4, 31),
      user.id,
      4,
      Math.max(Number(offset) || 0, 0),
    );
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categorias disponíveis no catálogo' })
  categories() {
    return this.productsService.categories();
  }

  @Get('filters')
  @ApiOperation({
    summary: 'Opções para montar os filtros (categorias, lojas e faixas reais)',
  })
  filters() {
    return this.productsService.filterOptions();
  }

  @Get('favorites')
  @ApiOperation({ summary: 'Produtos favoritos do usuário' })
  favorites(@CurrentUser() user: AuthUser) {
    return this.productsService.listFavorites(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do produto com série diária' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('period') period: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = Number(period);
    const days = [7, 30, 90].includes(parsed) ? parsed : 30;
    return this.productsService.findOne(id, days, user.id);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: 'Alterna favorito do produto para o usuário' })
  toggleFavorite(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.productsService.toggleFavorite(user.id, id);
  }
}
