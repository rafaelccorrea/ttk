import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class QueryVideosDto {
  @ApiPropertyOptional({ description: 'Filtra vídeos vinculados a um produto' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ example: 'achadinhos' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'false inclui videos sem midia (padrao: so reproduziveis)' })
  @IsOptional()
  @Transform(({ value }) => value !== 'false' && value !== false)
  @IsBoolean()
  playable?: boolean;

  @ApiPropertyOptional({ enum: ['product','trending'], description: 'product = vende produto; trending = viral sem produto' })
  @IsOptional()
  @IsIn(['product','trending'])
  kind?: 'product' | 'trending';

  @ApiPropertyOptional({ example: 'beleza' })
  @IsOptional()
  @IsString()
  category?: string;

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

  @ApiPropertyOptional({ description: 'Se true, retorna apenas os vídeos salvos do usuário' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  saved?: boolean;
}
