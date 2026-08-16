import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class GenerateScriptDto {
  @ApiProperty({ enum: ['live', 'video'] })
  @IsIn(['live', 'video'])
  type: 'live' | 'video';

  @ApiPropertyOptional({ description: 'Produto do catálogo (opcional)' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description: 'Produto do próprio usuário (cadastrado em Campanhas)',
  })
  @IsOptional()
  @IsUUID()
  userProductId?: string;

  @ApiPropertyOptional({ example: 'Cinta Modeladora Premium' })
  // O nome só é obrigatório quando não veio produto nenhum — do catálogo ou
  // do cadastro do próprio vendedor, o backend resolve o nome sozinho.
  @ValidateIf((o) => !o.productId && !o.userProductId)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  productName?: string;

  @ApiPropertyOptional({
    example: 'Cinta de alta compressão, 3 níveis de ajuste, R$ 39,90...',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  productDescription?: string;

  @ApiPropertyOptional({
    description: 'Foto do produto já enviada (POST /studio/product-image)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  productImageUrl?: string;

  @ApiPropertyOptional({
    enum: ['completo', 'pecas'],
    description: '`pecas` devolve ganchos, corpos e CTAs soltos para o Multiplicador',
  })
  @IsOptional()
  @IsIn(['completo', 'pecas'])
  formato?: 'completo' | 'pecas';

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10,
    default: 5,
    description: 'Quantos ganchos gerar (só com formato=pecas)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  hooksCount?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    default: 2,
    description: 'Quantos corpos gerar (só com formato=pecas)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  bodiesCount?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 3,
    default: 2,
    description: 'Quantos CTAs gerar (só com formato=pecas)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  ctasCount?: number;

  @ApiPropertyOptional({ example: 'divertido e urgente' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tone?: string;
}
