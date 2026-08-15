import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateStoreDto {
  @ApiProperty({ example: 'Minha Loja TikTok' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ default: 'tiktok_shop' })
  @IsOptional()
  @IsString()
  marketplace?: string;

  @ApiPropertyOptional({ default: 'BRL' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({
    enum: ['dmy', 'mdy'],
    default: 'dmy',
    description: 'Ordem de dia/mês nas datas dos relatórios exportados.',
  })
  @IsOptional()
  @IsIn(['dmy', 'mdy'])
  dateOrder?: 'dmy' | 'mdy';

  @ApiPropertyOptional({ description: 'Comissão padrão do marketplace (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPct?: number;

  @ApiPropertyOptional({ description: 'Imposto padrão sobre a venda (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxPct?: number;
}
