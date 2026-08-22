import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { DevLoginDto } from './dto/dev-login.dto';
import {
  ForgotPasswordDto,
  GoogleLoginDto,
  LoginDto,
  RegisterDto,
  ResendDto,
  ResetPasswordDto,
} from './dto/register.dto';

// Rotas anônimas e caras de abusar (senha, envio de e-mail). O limite por IP
// é o que separa 'esqueci a senha' de força bruta e de spam com nosso remetente.
@ApiTags('auth')
@Throttle({ default: { ttl: 60000, limit: 20 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Config pública de auth (ex.: se o cadastro está em lista de espera)',
  })
  config() {
    return this.authService.publicConfig();
  }

  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post('register')
  @ApiOperation({
    summary: 'Cadastro com confirmação de e-mail (Nodemailer)',
  })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.ref);
  }

  @Throttle({ default: { ttl: 300000, limit: 10 } })
  @Post('login')
  @ApiOperation({ summary: 'Login por e-mail e senha (exige confirmação)' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  // Mesmo limite do login por senha: é a mesma porta, só muda a chave.
  @Throttle({ default: { ttl: 300000, limit: 10 } })
  @Post('google')
  @ApiOperation({
    summary: 'Login/cadastro com Google (valida o id_token no backend)',
  })
  googleLogin(@Body() dto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(dto.credential, dto.ref);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Get('confirm')
  @ApiOperation({ summary: 'Confirma o e-mail pelo token do link' })
  confirm(@Query('token') token: string) {
    return this.authService.confirm(token);
  }

  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post('resend')
  @ApiOperation({ summary: 'Reenvia o link de confirmação' })
  resend(@Body() dto: ResendDto) {
    return this.authService.resend(dto.email);
  }

  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Envia o link de redefinição de senha (resposta sempre genérica)',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @Post('reset-password')
  @ApiOperation({ summary: 'Define a nova senha a partir do token do link' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('dev-login')
  @ApiOperation({
    summary:
      'Login de desenvolvimento (sem senha). Habilitado via ALLOW_DEV_LOGIN=true.',
  })
  devLogin(@Body() dto: DevLoginDto) {
    return this.authService.devLogin(dto.email);
  }
}
