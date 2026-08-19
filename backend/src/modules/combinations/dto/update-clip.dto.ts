import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateClipDto {
  /** Etiqueta de produto. String vazia limpa a etiqueta (vira null). */
  @ApiPropertyOptional({
    example: 'CINTA',
    description: 'De qual produto é o clipe. Vazio remove a etiqueta.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  produto?: string;
}
