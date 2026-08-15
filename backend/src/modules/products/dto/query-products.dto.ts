import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryProductsDto {
  @ApiPropertyOptional({ enum: [7, 30, 90], default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90])
  period?: number = 30;

  @ApiPropertyOptional({ example: 'beleza' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'cinta' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'Loja da Fábrica' })
  @IsOptional()
  @IsString()
  store?: string;

  // ------------------------------------------------------------- Faixas

  @ApiPropertyOptional({ description: 'Preço mínimo em BRL', example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Preço máximo em BRL', example: 150 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Vendas mínimas no período', example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSales?: number;

  @ApiPropertyOptional({ description: 'Receita mínima no período (BRL)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minRevenue?: number;

  @ApiPropertyOptional({
    description: 'Crescimento mínimo em % vs. período anterior (aceita negativo)',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minGrowth?: number;

  @ApiPropertyOptional({ description: 'Nota mínima (0 a 5)', example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  // ------------------------------------------------------------ Atalhos

  @ApiPropertyOptional({
    description: 'Só produtos favoritados pelo usuário',
    example: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  onlyFavorites?: boolean;

  @ApiPropertyOptional({ description: 'Só produtos com imagem' })
  @IsOptional()
  @Type(() => Boolean)
  withImage?: boolean;

  // --------------------------------------------------- Ordenação/página

  @ApiPropertyOptional({
    enum: ['sales', 'revenue', 'growth', 'price', 'rating', 'radar'],
    default: 'sales',
  })
  @IsOptional()
  @IsIn(['sales', 'revenue', 'growth', 'price', 'rating', 'radar'])
  sort?: 'sales' | 'revenue' | 'growth' | 'price' | 'rating' | 'radar' = 'sales';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 24, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 24;
}
