import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
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
  @MaxLength(80, { each: true })
  hooks: string[];

  @ApiProperty({ type: [String], description: 'Corpos (1-5 itens)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(80, { each: true })
  bodies: string[];

  @ApiProperty({ type: [String], description: 'CTAs (1-3 itens)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(80, { each: true })
  ctas: string[];
}
