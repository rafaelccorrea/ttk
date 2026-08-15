import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryCreatorsDto {
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
