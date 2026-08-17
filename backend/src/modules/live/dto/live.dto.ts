import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CriarLiveSessionDto {
  @ApiProperty({ example: 'Live de terça — kits de skincare' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;
}

/**
 * O que o vendedor pode digitar num produto.
 *
 * Fica de fora tudo que é procedência: `origin`, `sourceStartSec` e
 * `liveSessionId` contam de onde a linha veio e não são opinião de quem edita —
 * se o cliente pudesse mandar `origin`, bastaria uma tela distraída para que a
 * base inteira dissesse "manual" e a auditoria da extração perdesse o sentido.
 * `confidence` é a nota que o modelo deu a si mesmo, então também não se digita.
 */
export class AtualizarProdutoDto {
  @ApiPropertyOptional({ example: 'Kit Glow 3 em 1' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 129.9 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  priceBrl?: number;

  @ApiPropertyOptional({ type: [String], example: ['P', 'M', 'G'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  variants?: string[];

  @ApiPropertyOptional({ example: 'Frete grátis acima de R$ 199' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  shippingInfo?: string;

  @ApiPropertyOptional({ example: 'Leve 2 pague 1 só hoje' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  promo?: string;

  @ApiPropertyOptional({ type: [String], example: ['o kit rosa', 'aquele de 129'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  aliases?: string[];

  /** Desligar esconde o produto das respostas sem perder o histórico. */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CriarProdutoDto extends AtualizarProdutoDto {
  @ApiProperty({ example: 'Kit Glow 3 em 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}

export class AtualizarFaqDto {
  @ApiPropertyOptional({ example: 'Chega em quantos dias?' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question?: string;

  @ApiPropertyOptional({ example: 'De 5 a 9 dias úteis para todo o Brasil.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  answer?: string;

  @ApiPropertyOptional({ enum: ['faq', 'objecao', 'politica'] })
  @IsOptional()
  @IsIn(['faq', 'objecao', 'politica'])
  kind?: 'faq' | 'objecao' | 'politica';

  /**
   * Opcional e anulável: política de troca e prazo de entrega valem para a live
   * inteira, não para um produto. Mandar `null` é o jeito de soltar a resposta
   * do produto ao qual ela tinha sido presa por engano.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  liveProductId?: string | null;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  priority?: number;
}

export class AbrirLiveRunDto {
  @ApiProperty({ description: 'A base de conhecimento que a transmissão vai consultar' })
  @IsUUID()
  knowledgeSessionId: string;

  @ApiPropertyOptional({ example: '@lojadaana' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tiktokUsername?: string;

  @ApiPropertyOptional({ example: '7301234567890123456' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tiktokRoomId?: string;
}

/**
 * Uma mensagem como o app desktop a leu do chat.
 *
 * O `authorHash` chega pronto do desktop, e é assim de propósito: o username em
 * claro não precisa cruzar a rede nem existir no banco para o único uso que
 * temos dele (ver `LiveChatMessage.authorHash`). O que não chega aqui é o
 * `receivedAt` como opcional por acaso — o carimbo do desktop é o único que
 * reflete o instante em que a mensagem apareceu no chat; o do servidor já
 * carrega a fila e a rede, e é sobre esse instante que a janela de escalada
 * decide.
 */
export class MensagemDoChatDto {
  @ApiProperty({ example: '7301234567890123456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  externalMessageId: string;

  @ApiProperty({ example: 'a3f1c0...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  authorHash: string;

  @ApiProperty({ example: 'quanto custa o kit rosa?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;

  @ApiPropertyOptional({ example: '2026-08-17T20:31:04.120Z' })
  @IsOptional()
  @IsDateString()
  receivedAt?: string;
}

/**
 * O lote de ~800ms de chat.
 *
 * O teto de 200 mensagens não é defensivo à toa: o lote inteiro vira UMA
 * chamada ao modelo, e um lote gigante (o app acumulou durante uma queda de
 * rede e despejou tudo de uma vez) estoura a janela e faz a live perder o
 * momento em que as perguntas ainda importavam. Melhor o desktop cortar.
 */
export class LoteDeChatDto {
  @ApiProperty({ type: [MensagemDoChatDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MensagemDoChatDto)
  messages: MensagemDoChatDto[];
}

export class EncerrarLiveRunDto {
  @ApiPropertyOptional({ example: 'A live acabou' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class CriarFaqDto extends AtualizarFaqDto {
  @ApiProperty({ example: 'Chega em quantos dias?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question: string;

  @ApiProperty({ example: 'De 5 a 9 dias úteis para todo o Brasil.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  answer: string;
}
