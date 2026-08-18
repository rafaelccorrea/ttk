import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
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

/** Uma linha do lançamento em massa: o mesmo conteúdo, mais o id do vídeo. */
export class VideoResultItemDto extends VideoResultDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;
}

/**
 * Lançamento de vários vídeos numa requisição.
 *
 * O teto de 150 é a matriz cheia (10 × 5 × 3) — a tela de lançamento mostra o
 * plano inteiro, então o corpo precisa caber o plano inteiro, e nem um a mais.
 */
export class BulkVideoResultDto {
  @ApiProperty({ type: [VideoResultItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(150)
  @ValidateNested({ each: true })
  @Type(() => VideoResultItemDto)
  itens: VideoResultItemDto[];
}
