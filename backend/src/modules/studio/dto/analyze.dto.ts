import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AnalyzeDto {
  @ApiProperty({ description: 'Transcrição do vídeo viral' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  transcript: string;

  @ApiPropertyOptional({ description: 'Produto do catálogo para adaptar o roteiro' })
  @IsOptional()
  @IsUUID()
  productId?: string;
}
