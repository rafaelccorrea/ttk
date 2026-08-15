import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateMediaDto {
  @ApiProperty({ enum: ['image', 'video'] })
  @IsIn(['image', 'video'])
  kind: 'image' | 'video';

  @ApiProperty({
    example:
      'Vídeo vertical estilo UGC: pessoa tira uma garrafa térmica rosa da sacola de compras e reage empolgada.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  prompt: string;

  @ApiPropertyOptional({ enum: ['9:16', '16:9', '1:1'], default: '9:16' })
  @IsOptional()
  @IsIn(['9:16', '16:9', '1:1'])
  aspectRatio?: string;
}
