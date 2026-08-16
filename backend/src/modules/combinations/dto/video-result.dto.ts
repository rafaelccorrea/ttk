import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Desempenho de um vídeo publicado. Todos os campos são opcionais.
 *
 * `null` é aceito de propósito em cada um: é assim que o vendedor apaga um
 * número que digitou errado, sem precisar de outra rota. Por isso os validadores
 * ficam atrás de `ValidateIf` — sem ele, `null` seria recusado como inválido.
 */
export class VideoResultDto {
  @ApiPropertyOptional({ example: 12400, nullable: true })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(0)
  views?: number | null;

  @ApiPropertyOptional({ example: 8, nullable: true })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsInt()
  @Min(0)
  sales?: number | null;

  @ApiPropertyOptional({
    example: 'https://www.tiktok.com/@loja/video/123',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null && valor !== '')
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  postUrl?: string | null;
}
