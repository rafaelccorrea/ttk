import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { SupportService } from '../support/support.service';

class SupportReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text: string;
}

class ListUsersDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  busca?: string;

  @IsOptional()
  @IsString()
  plano?: string;

  /** Recorte por situação da conta — ver `AdminService.listUsers`. */
  @IsOptional()
  @IsIn([
    'confirmado',
    'nao_confirmado',
    'google',
    'stripe',
    'fila',
    'ativos_7d',
    'inativos_30d',
    'nunca_usou',
  ])
  situacao?: string;

  /** Só contas cadastradas nos últimos N dias. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  cadastroDias?: number;

  @IsOptional()
  @IsIn(['cadastro', 'ultimo_acesso', 'gastos', 'creditos', 'email'])
  ordenar?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direcao?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class SetPlanDto {
  @IsString()
  @IsNotEmpty()
  plano: string;
}

class AdjustCreditsDto {
  // Sem @Min(1): valor negativo é retirada, e o serviço barra saldo negativo.
  @Type(() => Number)
  @IsInt()
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  motivo: string;

  /** Avisa o cliente por e-mail (só faz sentido quando `amount` > 0). */
  @IsOptional()
  @IsBoolean()
  notificar?: boolean;
}

class NotificarCreditoDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  /** Texto livre do suporte que vai destacado no e-mail. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mensagem?: string;
}

/**
 * Área administrativa: ver e ajustar contas.
 *
 * O guard é de classe, então toda rota nova aqui já nasce restrita — não
 * depende de alguém lembrar de decorar o método.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly support: SupportService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Números gerais: contas, planos, receita e consumo' })
  overview() {
    return this.admin.overview();
  }

  /**
   * A margem que realmente aconteceu, contra a que a tabela de preços promete.
   *
   * Fica no admin e não no painel do cliente por motivo óbvio: é o nosso custo.
   */
  @Get('margem')
  @ApiOperation({
    summary: 'Margem realizada por recurso e ações cujo custo passou do estimado',
  })
  margem(@Query('dias') dias?: string) {
    return this.admin.margemRealizada(Number(dias) || 30);
  }

  @Get('users')
  @ApiOperation({ summary: 'Lista contas com busca e filtro por plano' })
  users(@Query() query: ListUsersDto) {
    return this.admin.listUsers(query);
  }

  /**
   * Contas criadas depois de `desde` — é o que alimenta o toast do painel.
   * O front guarda a última data vista e pergunta de minuto em minuto.
   */
  @Get('novas-contas')
  @ApiOperation({ summary: 'Contas criadas depois de uma data (toast do admin)' })
  novasContas(@Query('desde') desde?: string) {
    return this.admin.novasContas(desde);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Ficha da conta com o extrato de créditos' })
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.userDetail(id);
  }

  @Patch('users/:id/plan')
  @ApiOperation({ summary: 'Troca o plano manualmente (suporte)' })
  setPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPlanDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.admin.setPlan(id, dto.plano, admin.email);
  }

  @Post('users/:id/credits')
  @ApiOperation({ summary: 'Concede ou retira créditos, com motivo no extrato' })
  credits(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustCreditsDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.admin.adjustCredits(
      id,
      dto.amount,
      dto.motivo,
      admin.email,
      dto.notificar ?? false,
    );
  }

  @Post('users/:id/aviso-credito')
  @ApiOperation({
    summary: 'Envia e-mail avisando o cliente de créditos concedidos (não altera o saldo)',
  })
  avisoCredito(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NotificarCreditoDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.admin.notificarCredito(id, dto.amount, dto.mensagem, admin.email);
  }

  // ---------- chat de suporte: só o admin vê e responde ----------

  @Get('support/conversas')
  @ApiOperation({ summary: 'Conversas do chat de suporte, com não lidas' })
  supportConversas() {
    return this.support.listConversations();
  }

  @Get('support/nao-lidas')
  @ApiOperation({ summary: 'Total de mensagens de suporte não lidas (badge)' })
  async supportNaoLidas() {
    return { total: await this.support.unreadCount() };
  }

  @Get('support/conversas/:userId')
  @ApiOperation({ summary: 'Abre a conversa de um usuário e marca como lida' })
  supportConversa(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.support.conversation(userId);
  }

  @Post('support/conversas/:userId/mensagens')
  @ApiOperation({ summary: 'Responde o usuário no chat de suporte' })
  supportResponder(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SupportReplyDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.support.reply(userId, dto.text, admin.email);
  }
}
