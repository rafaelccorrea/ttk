import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { DevLoginDto } from './dto/dev-login.dto';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendDto,
  ResetPasswordDto,
} from './dto/register.dto';

@ApiTags('auth')
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

  @Post('register')
  @ApiOperation({
    summary: 'Cadastro com confirmação de e-mail (Nodemailer)',
  })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login por e-mail e senha (exige confirmação)' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Get('confirm')
  @ApiOperation({ summary: 'Confirma o e-mail pelo token do link' })
  confirm(@Query('token') token: string) {
    return this.authService.confirm(token);
  }

  @Post('resend')
  @ApiOperation({ summary: 'Reenvia o link de confirmação' })
  resend(@Body() dto: ResendDto) {
    return this.authService.resend(dto.email);
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Envia o link de redefinição de senha (resposta sempre genérica)',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Define a nova senha a partir do token do link' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('dev-login')
  @ApiOperation({
    summary:
      'Login de desenvolvimento (sem senha). Habilitado via ALLOW_DEV_LOGIN=true.',
  })
  devLogin(@Body() dto: DevLoginDto) {
    return this.authService.devLogin(dto.email);
  }
}
