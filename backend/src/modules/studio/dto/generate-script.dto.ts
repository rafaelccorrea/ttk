import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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

  @ApiPropertyOptional({ example: 'Cinta Modeladora Premium' })
  @ValidateIf((o) => !o.productId)
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

  @ApiPropertyOptional({ example: 'divertido e urgente' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tone?: string;
}
