import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryCreatorsDto {
  @ApiPropertyOptional({ enum: ['tiktok','seed'], description: 'tiktok = coletado do TikTok' })
  @IsOptional()
  @IsIn(['tiktok','seed'])
  source?: 'tiktok' | 'seed';

  @ApiPropertyOptional({ description: 'Seguidores minimos' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minFollowers?: number;

  @ApiPropertyOptional({ description: 'Seguidores maximos' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxFollowers?: number;

  @ApiPropertyOptional({ example: 'garcia' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'beleza' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: ['gmv', 'followers'], default: 'gmv' })
  @IsOptional()
  @IsIn(['gmv', 'followers'])
  sort?: 'gmv' | 'followers' = 'gmv';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 25;
}
