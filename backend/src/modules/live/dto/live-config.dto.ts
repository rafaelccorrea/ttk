import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * O relato de que a cascata inteira de seletores falhou.
 *
 * O `html` chega grande e sujo, e é assim mesmo: o app não tenta escolher o que
 * mandar porque escolher no cliente é a mesma coisa que confiar no cliente. Quem
 * corta o texto de gente é o servidor (`sanitizarHtml`), sempre, antes de gravar
 * e antes de logar. O teto aqui é só para o corpo da requisição não virar
 * megabytes: o container do chat de uma live com muita mensagem é enorme, e o
 * que interessa — o esqueleto de tags perto do campo de comentário — cabe folgado
 * no começo dele.
 */
export class ReportarFalhaDeSeletorDto {
  @ApiPropertyOptional({ description: 'A run em andamento, quando já existe' })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiProperty({ example: 1, description: 'A versão da cascata que falhou' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  version: number;

  @ApiProperty({ description: 'HTML do container — saneado no servidor' })
  @IsString()
  @MaxLength(200_000)
  html: string;

  @ApiPropertyOptional({ example: 'Electron/33.0.0 Chrome/130.0.0.0' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;

  /**
   * QUAL cascata falhou. Com quatro em produção (campo, botão de enviar,
   * banner de aviso, botão de encerrar), um relatório sem contexto é ambíguo —
   * e a urgência de cada uma é diferente. Lista fechada: o app não inventa
   * categorias.
   */
  @ApiPropertyOptional({ example: 'aviso' })
  @IsOptional()
  @IsIn([
    'campo',
    'botao_enviar',
    'aviso',
    'botao_encerrar',
    'painel_produtos',
    'botao_pin',
  ])
  contexto?: string;
}

/**
 * O aceite do termo de risco do envio automático.
 *
 * A versão é obrigatória e é conferida contra a vigente no servidor: sem ela, o
 * registro diria apenas que alguém clicou em algo. Se o app mandar uma versão
 * antiga, é porque está exibindo um texto que já não descreve o risco atual — e
 * o backend recusa, em vez de carimbar um aceite para um aviso que o vendedor
 * não leu.
 */
export class AceitarEnvioAutomaticoDto {
  @ApiProperty({ example: '2026-08-envio-automatico-v1' })
  @IsString()
  @MaxLength(120)
  versao: string;
}
