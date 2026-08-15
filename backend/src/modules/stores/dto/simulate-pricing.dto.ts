import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class SimulatePricingDto {
  @ApiProperty({ description: 'Custo do produto por unidade' })
  @IsNumber()
  @Min(0)
  cost: number;

  @ApiPropertyOptional({ description: 'Preço praticado (para calcular a margem atual)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Frete por unidade pago pelo vendedor' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @ApiPropertyOptional({ description: 'Embalagem e outros custos por unidade' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  otherCost?: number;

  @ApiPropertyOptional({ description: 'Comissão do marketplace (%). Padrão: a da loja.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPct?: number;

  @ApiPropertyOptional({ description: 'Imposto sobre a venda (%). Padrão: o da loja.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxPct?: number;

  @ApiPropertyOptional({ description: 'Margem líquida desejada (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  targetMarginPct?: number;
}
