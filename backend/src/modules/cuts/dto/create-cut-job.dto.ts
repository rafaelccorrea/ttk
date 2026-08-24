import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { LIMITES } from '../cut-planner';

/**
 * Campos do multipart de `POST /cuts`. Chegam como string no form-data, por
 * isso o `@Type(() => Number)` — sem ele o `@IsInt` recusa "10".
 */
export class CreateCutJobDto {
  @ApiProperty({ enum: ['rapido', 'inteligente'] })
  @IsIn(['rapido', 'inteligente'])
  mode: 'rapido' | 'inteligente';

  @ApiPropertyOptional({ enum: ['9:16', '16:9', '1:1'], default: '9:16' })
  @IsOptional()
  @IsIn(['9:16', '16:9', '1:1'])
  format?: '9:16' | '16:9' | '1:1';

  /** Queimar a legenda no vídeo. Só tem efeito no modo inteligente. */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  captions?: boolean;

  @ApiProperty({ minimum: LIMITES.qtdMin, maximum: LIMITES.qtdMax })
  @Type(() => Number)
  @IsInt()
  @Min(LIMITES.qtdMin)
  @Max(LIMITES.qtdMax)
  quantity: number;

  @ApiProperty({ minimum: LIMITES.corteMinSeg, maximum: LIMITES.corteMaxSeg })
  @Type(() => Number)
  @IsInt()
  @Min(LIMITES.corteMinSeg)
  @Max(LIMITES.corteMaxSeg)
  minSeconds: number;

  @ApiProperty({ minimum: LIMITES.corteMinSeg, maximum: LIMITES.corteMaxSeg })
  @Type(() => Number)
  @IsInt()
  @Min(LIMITES.corteMinSeg)
  @Max(LIMITES.corteMaxSeg)
  maxSeconds: number;
}
