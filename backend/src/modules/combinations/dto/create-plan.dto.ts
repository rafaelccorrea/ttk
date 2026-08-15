import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class CreatePlanDto {
  @ApiProperty({ example: 'CINTA', description: 'Sigla do produto (1-10 caracteres)' })
  @IsString()
  @Length(1, 10)
  sigla: string;

  @ApiProperty({ enum: ['9:16', '16:9', '1:1'] })
  @IsIn(['9:16', '16:9', '1:1'])
  format: '9:16' | '16:9' | '1:1';

  @ApiProperty({ type: [String], description: 'Ganchos (1-10 itens)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(120, { each: true })
  hooks: string[];

  // Corpo e CTA são opcionais: o vendedor pode querer só GANCHO + CTA, que é
  // o formato curto que roda melhor em conta nova.
  @ApiProperty({ type: [String], description: 'Corpos (0-5 itens)' })
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(120, { each: true })
  bodies: string[];

  @ApiProperty({ type: [String], description: 'CTAs (0-3 itens)' })
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(120, { each: true })
  ctas: string[];

  // Clipes enviados antes (POST /combinations/clips). Quando vêm, o plano
  // pode ser montado de verdade em vídeo; quando não, ele é só o plano.
  @ApiPropertyOptional({ type: [String], description: 'Ids dos clipes de gancho' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  hookClipIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Ids dos clipes de corpo' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  bodyClipIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Ids dos clipes de CTA' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsUUID('4', { each: true })
  ctaClipIds?: string[];
}
