import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

class PaginationDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class QueryStoreOrdersDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ['pendente', 'enviado', 'concluido', 'cancelado'],
  })
  @IsOptional()
  @IsIn(['pendente', 'enviado', 'concluido', 'cancelado'])
  stage?: string;

  @ApiPropertyOptional({ description: 'Busca por número do pedido ou SKU' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Janela em dias (padrão 30)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  period?: number;

  @ApiPropertyOptional({ description: 'Somente pedidos com prazo de envio estourado' })
  @IsOptional()
  @IsIn(['true', 'false'])
  lateOnly?: string;
}

export class QueryStoreProductsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Busca por SKU, título ou categoria' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['title', 'stock', 'price', 'margin'] })
  @IsOptional()
  @IsIn(['title', 'stock', 'price', 'margin'])
  sort?: string;

  @ApiPropertyOptional({ description: 'Somente SKUs sem custo cadastrado' })
  @IsOptional()
  @IsIn(['true', 'false'])
  missingCost?: string;
}

export class QueryPeriodDto {
  @ApiPropertyOptional({ default: 30, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  period?: number;
}
