import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateUserProductDto {
  @ApiProperty({ example: 'Fatiador de legumes 7 em 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 49.9 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  priceBrl?: number;

  @ApiPropertyOptional({ example: 'Corta tudo em segundos, sem sujeira.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  benefit?: string;

  @ApiPropertyOptional({ example: 'Perder 20 minutos picando cebola.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  problemSolved?: string;

  /** URLs das fotos. São espelhadas no S3 e validadas contra SSRF. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  images?: string[];

  /** Importar do catálogo público em vez de digitar. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceProductId?: string;
}

export class CreatePersonaDto {
  @ApiPropertyOptional({ example: 'Ju da cozinha' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  /**
   * Só ids do catálogo (`GET /campaigns/persona-options`). O servidor valida
   * cada um e monta a descrição — o cliente nunca envia texto de aparência.
   */
  @ApiProperty({
    example: {
      genero: 'mulher',
      idade: '25-34',
      tomDePele: 'morena-clara',
      cabelo: 'loiro-longo',
      corpo: 'medio',
      figurino: 'vestido-vermelho',
      cenario: 'cozinha',
      energia: 'animada',
    },
  })
  @IsObject()
  attrs: Record<string, string>;
}

export class CreateCampaignDto {
  @ApiProperty()
  @IsUUID()
  userProductId: string;

  @ApiProperty()
  @IsUUID()
  personaId: string;

  /**
   * 15s era o único formato "curto", e é o pior para vender: com a regra de
   * gancho com rosto, sobra um slot de demonstração. 45s e 60s existem porque
   * o custo é linear por cena — não havia razão técnica para o teto de 30s.
   */
  @ApiPropertyOptional({ enum: [15, 30, 45, 60], default: 15 })
  @IsOptional()
  @IsIn([15, 30, 45, 60])
  durationSeconds?: number;
}

export class UpdateCampaignDto {
  /** Liga/desliga as legendas queimadas do vídeo final. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  subtitles?: boolean;
}

export class UpdateSceneDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  fala?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  acaoVisual?: string;

  /**
   * Troca a foto de onde a cena de produto parte.
   *
   * Só aceita uma URL que JÁ esteja na galeria do produto — o servidor
   * confere. Aceitar URL livre aqui seria deixar o cliente escolher qualquer
   * imagem da internet como frame do vídeo (SSRF e conteúdo de terceiros).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseImageUrl?: string;
}
