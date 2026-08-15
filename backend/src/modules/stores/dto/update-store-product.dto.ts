import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateStoreProductDto {
  @ApiPropertyOptional({ description: 'Custo do produto por unidade' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({ description: 'Preço de venda praticado' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Estoque mínimo para alerta de ruptura' })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockAlert?: number;
}
