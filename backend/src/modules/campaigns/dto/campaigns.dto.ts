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
      voz: 'feminina-jovem',
    },
  })
  @IsObject()
  attrs: Record<string, string>;
}

/**
 * Persona a partir de uma foto de referência. Vem em multipart junto com o
 * arquivo, então `attrs` chega como JSON em string — o servidor faz o parse e
 * valida contra o catálogo do mesmo jeito que em `CreatePersonaDto`.
 */
export class CreatePersonaFromPhotoDto {
  @ApiPropertyOptional({ example: 'Rafael do PikPok' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @ApiProperty({
    description: 'JSON com os ids do catálogo (mesmo formato de CreatePersonaDto.attrs)',
    example: '{"genero":"homem","idade":"25-34",...}',
  })
  @IsString()
  @IsNotEmpty()
  attrs: string;
}

/**
 * Edição de persona SEM novo retrato: apelido e voz não entram no prompt de
 * imagem, então mudar aqui é grátis e vale já para a próxima renderização.
 * Atributos visuais (cabelo, figurino...) ficam de fora de propósito — mudar
 * a aparência exige regenerar o retrato, que é outra operação (e outra cobrança).
 */
export class UpdatePersonaDto {
  @ApiPropertyOptional({ example: 'Ju da cozinha' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  /** Id de voz do catálogo (`persona-options`, grupo "voz"). */
  @ApiPropertyOptional({ example: 'masculina-grave' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  voz?: string;
}

export class CreateCampaignDto {
  @ApiProperty()
  @IsUUID()
  userProductId: string;

  /** Obrigatória, EXCETO quando `estilo = 'sem_apresentador'`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  personaId?: string;

  /**
   * 15s era o único formato "curto", e é o pior para vender: com a regra de
   * gancho com rosto, sobra um slot de demonstração. 45s e 60s existem porque
   * o custo é linear por cena — não havia razão técnica para o teto de 30s.
   */
  @ApiPropertyOptional({ enum: [15, 30, 45, 60], default: 15 })
  @IsOptional()
  @IsIn([15, 30, 45, 60])
  durationSeconds?: number;

  /** Com apresentador, sem apresentador, ou a IA decide (default). */
  @ApiPropertyOptional({ enum: ['ugc', 'sem_apresentador', 'misto'], default: 'misto' })
  @IsOptional()
  @IsIn(['ugc', 'sem_apresentador', 'misto'])
  estilo?: 'ugc' | 'sem_apresentador' | 'misto';

  /**
   * Voz do narrador (id do grupo `voz` do catálogo) — obrigatória quando o
   * estilo é `sem_apresentador`, ignorada nos demais (a voz vem da persona).
   */
  @ApiPropertyOptional({ example: 'feminina-jovem' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  vozNarrador?: string;
}

export class UpdateCampaignDto {
  /** Liga/desliga as legendas queimadas do vídeo final. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  subtitles?: boolean;
}

export class UpdateSceneDto {
  /**
   * 90 caracteres ≈ 12 palavras ditas COM CALMA em 5 segundos. O teto antigo
   * de 400 deixava escrever um parágrafo que o modelo atropelava ou cortava
   * no fim do clipe — o limite aqui é o limite físico da cena.
   */
  @ApiPropertyOptional({ maxLength: 90 })
  @IsOptional()
  @IsString()
  @MaxLength(90)
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

  /** Formato da cena — trocar invalida o render pendente e refaz o prompt. */
  @ApiPropertyOptional({
    enum: ['apresentador', 'apresentador_produto', 'mao_produto', 'unboxing', 'produto_close'],
  })
  @IsOptional()
  @IsIn(['apresentador', 'apresentador_produto', 'mao_produto', 'unboxing', 'produto_close'])
  tipoCena?: 'apresentador' | 'apresentador_produto' | 'mao_produto' | 'unboxing' | 'produto_close';

  /** Como a fala vira áudio; "fala" só é aceita em cena com apresentador. */
  @ApiPropertyOptional({ enum: ['fala', 'narracao', 'sem_fala'] })
  @IsOptional()
  @IsIn(['fala', 'narracao', 'sem_fala'])
  modoAudio?: 'fala' | 'narracao' | 'sem_fala';
}
