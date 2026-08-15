import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryVideosDto {
  @ApiPropertyOptional({ example: 'achadinhos' })
  @IsOptional()
  @IsString()
  search?: string;

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

  @ApiPropertyOptional({ default: 24, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 24;

  @ApiPropertyOptional({ description: 'Se true, retorna apenas os vídeos salvos do usuário' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  saved?: boolean;
}
