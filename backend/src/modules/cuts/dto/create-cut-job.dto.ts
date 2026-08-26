import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUrl, Max, Min } from 'class-validator';
import {
  CAPTION_STYLES,
  CaptionStyle,
  LIMITES,
  REFRAME_MODES,
  ReframeMode,
} from '../cut-planner';

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

  /** Perfil visual da legenda queimada (só com `captions`). */
  @ApiPropertyOptional({ enum: CAPTION_STYLES, default: 'classico' })
  @IsOptional()
  @IsIn(CAPTION_STYLES)
  captionStyle?: CaptionStyle;

  /** Fonte mais larga que o formato: seguir o rosto (padrão) ou fundo desfocado. */
  @ApiPropertyOptional({ enum: REFRAME_MODES, default: 'rosto' })
  @IsOptional()
  @IsIn(REFRAME_MODES)
  reframe?: ReframeMode;

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

/**
 * `POST /cuts/from-url`: os mesmos parâmetros, mais o link. Chega como JSON
 * (não multipart), então o `@Type` continua inofensivo e o `@IsUrl` recusa
 * texto solto antes de qualquer download.
 */
export class CreateCutJobFromUrlDto extends CreateCutJobDto {
  @ApiProperty({ example: 'https://www.youtube.com/watch?v=...' })
  @IsUrl({ require_protocol: true })
  url: string;
}
