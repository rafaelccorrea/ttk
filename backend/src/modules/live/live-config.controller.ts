import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import {
  AceitarEnvioAutomaticoDto,
  ReportarFalhaDeSeletorDto,
} from './dto/live-config.dto';
import { LiveConfigService } from './live-config.service';

/**
 * A configuração remota do envio automático.
 *
 * Autenticada e atrás da feature `live_copilot` como todo o resto da live, e
 * isso importa mais aqui do que parece: a cascata de seletores é o mapa de como
 * automatizar o chat do TikTok, e servi-la aberta seria publicá-lo. O plano
 * Business não é só cobrança neste ponto — é a superfície mínima.
 */
@ApiTags('live')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
@RequiresPlanFeature('live_copilot')
@Controller('live')
export class LiveConfigController {
  constructor(private readonly config: LiveConfigService) {}

  /**
   * O app busca isto antes de cada live — e é o que o mantém consertável.
   *
   * Nada aqui é calculado por usuário: é a mesma resposta para todo mundo, de
   * propósito. Configuração de operação que varia por conta viraria, na primeira
   * emergência, a pergunta "mas isso está ligado para QUEM?" — que é exatamente
   * a pergunta que não se quer estar fazendo com contas sendo banidas.
   */
  @Get('config/envio')
  @ApiOperation({
    summary: 'Seletores, limites e kill switch do envio automático',
  })
  envio() {
    return this.config.configDeEnvio();
  }

  /**
   * Onde baixar o app, e qual versão está publicada.
   *
   * A URL vem de variável de ambiente e não do código porque publicar release é
   * ato de operação, não de deploy: sai um instalador novo sem o backend mudar
   * de linha. E enquanto não houver release nenhum, a resposta diz isso
   * explicitamente — a tela mostra "em breve" em vez de um botão que baixa 404,
   * que é a pior forma de anunciar um produto que ainda não existe para o
   * cliente.
   */
  @Get('download')
  @ApiOperation({ summary: 'URL e versão do instalador do app de desktop' })
  download() {
    return this.config.downloadDoApp();
  }

  /**
   * O termo de risco e o que este usuário já aceitou.
   *
   * O app precisa dos dois na mesma resposta: o texto para exibir e o carimbo
   * para saber se ainda precisa exibir. Separar em duas chamadas abriria a
   * janela em que a tela decide sozinha que já foi aceito.
   */
  @Get('termo-envio-automatico')
  @ApiOperation({ summary: 'Texto do termo de risco e o aceite deste usuário' })
  termo(@CurrentUser() user: AuthUser) {
    return this.config.termoParaUsuario(user.id);
  }

  /**
   * O aceite. É esta chamada que destrava o modo `auto` — o backend recusa
   * abrir ou trocar para automático sem ela, e a recusa é no servidor porque a
   * tela que mostra o aviso é do cliente.
   */
  @Post('aceitar-envio-automatico')
  @ApiOperation({ summary: 'Registra o aceite do termo de envio automático' })
  aceitar(
    @CurrentUser() user: AuthUser,
    @Body() dto: AceitarEnvioAutomaticoDto,
  ) {
    return this.config.aceitarEnvioAutomatico(user.id, dto.versao);
  }

  /**
   * A cascata inteira falhou: o TikTok provavelmente mudou o HTML.
   *
   * Responde 202 porque é telemetria — o app não tem nada a fazer com o
   * resultado e não pode ficar preso esperando o INSERT no meio de uma live.
   */
  @Post('telemetry/selector-failure')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Relata que nenhum seletor casou (HTML saneado no servidor)',
  })
  falhaDeSeletor(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReportarFalhaDeSeletorDto,
  ) {
    return this.config.registrarFalhaDeSeletor(user.id, {
      runId: dto.runId ?? null,
      version: dto.version,
      html: dto.html,
      userAgent: dto.userAgent ?? null,
      contexto: dto.contexto ?? null,
    });
  }
}
