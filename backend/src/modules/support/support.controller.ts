import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { SupportService } from './support.service';
import { UserThrottlerGuard } from '../../common/throttler/user-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import {
  LIMITE_CONTATO,
} from '../../common/throttler/limites';

@ApiTags('support')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, UserThrottlerGuard)
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('messages')
  @ApiOperation({ summary: 'Histórico do chat de suporte do usuário' })
  list(@CurrentUser() user: AuthUser) {
    return this.supportService.list(user.id);
  }

  @Throttle(LIMITE_CONTATO)
  @Post('messages')
  @ApiOperation({ summary: 'Envia mensagem ao suporte' })
  send(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) {
    return this.supportService.send(user.id, dto.text, user.email);
  }
}
