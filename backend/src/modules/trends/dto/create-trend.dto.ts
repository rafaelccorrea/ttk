import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTrendDto {
  @ApiProperty({ example: 'Air fryer receitas' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: '#airfryer' })
  @IsOptional()
  @IsString()
  hashtag?: string;

  @ApiPropertyOptional({ example: 'cozinha' })
  @IsOptional()
  @IsString()
  category?: string;
}
