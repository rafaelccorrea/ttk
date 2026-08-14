import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { DevLoginDto } from './dto/dev-login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('dev-login')
  @ApiOperation({
    summary:
      'Login de desenvolvimento (sem Supabase). Habilitado via ALLOW_DEV_LOGIN=true.',
  })
  devLogin(@Body() dto: DevLoginDto) {
    return this.authService.devLogin(dto.email);
  }
}
