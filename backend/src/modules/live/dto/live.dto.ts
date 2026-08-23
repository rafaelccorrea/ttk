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

  /**
   * Texto livre que ensina a IA: garantia, material, medidas, voltagem, o que
   * vem na caixa, condição de troca. Vai inteiro para o prompt da live.
   */
  @ApiPropertyOptional({
    example: 'Garantia de 1 ano. Vem com capinha e película. Tela de 6,5".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;

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

  /**
   * O TikTok marcou esta mensagem como PERGUNTA (evento `questionNew` do
   * webcast). É sinal do próprio espectador — ele usou o cartão de pergunta —
   * então fura a heurística local: pergunta declarada nunca é descartada como
   * ruído e passa na frente do lote.
   */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isQuestion?: boolean;
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

/**
 * Um instantâneo de audiência, como o app desktop o agregou.
 *
 * Os contadores são DELTAS da janela de agregação (~30s), não acumulados — ver
 * `LiveRunMetric`. `viewerCount` é leitura de nível e pode faltar quando o
 * webcast não a entregou na janela.
 */
export class InstantaneoDeMetricaDto {
  @ApiProperty({ example: '2026-08-17T20:31:00.000Z' })
  @IsDateString()
  capturedAt: string;

  @ApiPropertyOptional({ example: 312 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  viewerCount?: number;

  @ApiPropertyOptional({ example: 480 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  likes?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  gifts?: number;

  @ApiPropertyOptional({ example: 55 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  giftDiamonds?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  follows?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  shares?: number;

  @ApiPropertyOptional({ example: 18 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  joins?: number;
}

/**
 * O lote de instantâneos de audiência.
 *
 * É lote (e não um ponto por request) pelo mesmo motivo do chat: numa queda de
 * rede o app acumula e despeja tudo quando reconecta. O teto de 120 cobre uma
 * hora inteira de janela de 30s guardada offline — mais que isso é live que já
 * não existe.
 */
export class LoteDeMetricasDto {
  @ApiProperty({ type: [InstantaneoDeMetricaDto] })
  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => InstantaneoDeMetricaDto)
  metrics: InstantaneoDeMetricaDto[];
}

export class EncerrarLiveRunDto {
  @ApiPropertyOptional({ example: 'A live acabou' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;

  /**
   * Fim DECLARADO pelo app (ex.: `aviso_tiktok`, quando o detector encerrou a
   * live de propósito). Sem ele, `motivo` preenchido continua virando `erro`.
   * A lista é fechada: o desktop não inventa categorias novas de fim.
   */
  @ApiPropertyOptional({ example: 'aviso_tiktok' })
  @IsOptional()
  @IsIn(['manual', 'aviso_tiktok'])
  endReason?: 'manual' | 'aviso_tiktok';
}

/**
 * Um evento de auditoria da run, reportado pelo app desktop.
 *
 * Lista de tipos FECHADA — o app não inventa categorias — e `detalhe` é texto
 * curto (o resumo do banner, o título do produto), nunca HTML: amostra de DOM
 * tem canal próprio, com sanitização, na telemetria de seletor.
 */
export class RegistrarEventoDaRunDto {
  @ApiProperty({ example: 'aviso_tiktok' })
  @IsIn(['aviso_tiktok', 'pin_produto'])
  tipo: 'aviso_tiktok' | 'pin_produto';

  @ApiPropertyOptional({ example: 'pausado' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  acao?: string;

  @ApiPropertyOptional({ example: 'Seu conteúdo pode violar as diretrizes…' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detalhe?: string;
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

/**
 * A troca do modo de resposta de uma transmissão em andamento.
 *
 * O modo é um literal fechado e não um booleano `automatico` porque a fase 3
 * já tem um terceiro modo em vista (sugestão com confirmação de um clique), e
 * um booleano teria que virar enum com o app antigo já instalado na máquina do
 * vendedor.
 */
export class TrocarModoDaRunDto {
  @ApiProperty({ enum: ['painel', 'auto'], example: 'auto' })
  @IsIn(['painel', 'auto'])
  mode: 'painel' | 'auto';
}

/**
 * O que o app relata depois de tentar postar a resposta no chat.
 *
 * `pendente`, `nao_aplica` e `cancelada` NÃO entram aqui: o primeiro é o estado
 * de onde se sai, o segundo é ausência de envio e o terceiro é decisão do
 * servidor (o descarte por idade). O cliente só relata o que ele mesmo
 * observou — saiu ou não saiu.
 */
export class ConfirmarEntregaDto {
  @ApiProperty({ enum: ['enviada', 'falhou'], example: 'enviada' })
  @IsIn(['enviada', 'falhou'])
  status: 'enviada' | 'falhou';

  @ApiPropertyOptional({
    example: 'Campo de comentário indisponível: a live pediu verificação.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  failureReason?: string;
}

/**
 * Salvar na base uma resposta aprovada no painel.
 *
 * O texto é opcional porque os dois caminhos são legítimos e dizem coisas
 * diferentes: sem ele, o vendedor está dizendo "o copiloto acertou, guarda
 * assim"; com ele, "quase — é assim que se responde isso". O segundo é o mais
 * valioso dos dois, e é por isso que a rota aceita edição em vez de só um
 * polegar para cima.
 */
export class SalvarNaBaseDto {
  @ApiPropertyOptional({
    description: 'A resposta corrigida. Sem isto, guarda o texto do copiloto.',
    example: 'Sai por R$ 89,90 e o frete é grátis acima de R$ 99.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}
