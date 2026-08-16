import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsHexColor,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class FolderDto {
  @ApiPropertyOptional({ example: 'Postar essa semana' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: '#fe2c55' })
  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class MoveVideosDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  // O teto é o da própria galeria: mover mais do que ela mostra de uma vez não
  // é caso de uso, é payload inflado.
  @ArrayMaxSize(300)
  @IsUUID('4', { each: true })
  videoIds: string[];

  @ApiPropertyOptional({
    description: 'Pasta de destino. `null` tira o vídeo de qualquer pasta.',
    nullable: true,
  })
  @IsOptional()
  // `null` é um valor legítimo aqui (tirar da pasta), então o IsUUID só vale
  // quando veio alguma coisa.
  @ValidateIf((_, valor) => valor !== null)
  @IsUUID()
  folderId?: string | null;
}
