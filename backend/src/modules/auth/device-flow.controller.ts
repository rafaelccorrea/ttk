import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from './auth-user';
import { DeviceFlowService } from './device-flow.service';
import {
  AprovarDeviceFlowDto,
  IniciarDeviceFlowDto,
  TrocarDeviceCodeDto,
} from './dto/device-flow.dto';
import { SupabaseAuthGuard } from './supabase-auth.guard';

/**
 * Device code flow: como o app desktop do Live Copilot vira uma sessão sem
 * nunca pedir a senha da conta. O app mostra um código curto, a pessoa aprova
 * no navegador onde já está logada, e o app troca seu segredo por um JWT — o
 * mesmo JWT que o guard já aceita no login por senha.
 */
@ApiTags('auth')
@Controller('auth/device')
export class DeviceFlowController {
  constructor(private readonly deviceFlow: DeviceFlowService) {}

  /**
   * Sem guard de propósito: quem chama aqui é justamente quem ainda não tem
   * sessão nenhuma. O limite por IP existe porque a rota cria linha no banco
   * e queima códigos curtos do espaço disponível.
   */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia o pareamento de um dispositivo' })
  start(@Body() dto: IniciarDeviceFlowDto) {
    return this.deviceFlow.iniciar(dto.deviceName);
  }

  /** A tela de aprovação lê isto para mostrar o que está sendo autorizado. */
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth()
  @Get(':userCode')
  @ApiOperation({ summary: 'Consulta uma autorização pelo código curto' })
  consultar(@Param('userCode') userCode: string) {
    return this.deviceFlow.consultarPorUserCode(userCode);
  }

  /**
   * COM guard: é a web logada. O dono da autorização sai da sessão do
   * navegador, nunca do corpo — senão qualquer um aprovaria em nome de outro.
   */
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth()
  @Post('approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprova o dispositivo (web autenticada)' })
  approve(@CurrentUser() user: AuthUser, @Body() dto: AprovarDeviceFlowDto) {
    return this.deviceFlow.aprovar(user.id, dto.userCode);
  }

  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth()
  @Post('deny')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recusa o dispositivo (web autenticada)' })
  deny(@CurrentUser() user: AuthUser, @Body() dto: AprovarDeviceFlowDto) {
    return this.deviceFlow.negar(user.id, dto.userCode);
  }

  /**
   * Sem guard — o `deviceCode` do corpo é a credencial. Por isso o limite é o
   * mais apertado do módulo: é uma rota anônima que aceita um segredo e
   * devolve um token de 30 dias, ou seja, um alvo natural de adivinhação. O
   * app legítimo consulta a cada poucos segundos enquanto a pessoa aprova, o
   * que cabe folgado em 30 por minuto; um varredor não chega a lugar nenhum
   * nesse ritmo contra 32 bytes de entropia.
   */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Troca o deviceCode aprovado por um token' })
  token(@Body() dto: TrocarDeviceCodeDto) {
    return this.deviceFlow.trocarPorToken(dto.deviceCode);
  }
}
