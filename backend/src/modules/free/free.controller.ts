import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { FreeSampleService } from './free-sample.service';
import { FreePlanGuard } from './free-plan.guard';

/**
 * A API da conta gratuita — ver `docs/CONTA-FREE.md`.
 *
 * **Por que um controller separado, e não um `if` dentro de Produtos/Vídeos.**
 * Um ramo condicional dentro do serviço pago faria os dois caminhos
 * compartilharem a construção da resposta, e a partir daí todo campo novo
 * adicionado ao produto vazaria para o gratuito por omissão — porque ninguém
 * lembrou de cortá-lo. Aqui o padrão de falha se inverte: o campo novo NÃO
 * aparece no gratuito até alguém escrevê-lo aqui de propósito.
 *
 * Repare no que estas rotas não têm: `@Query`. Nenhuma busca, filtro,
 * ordenação, período ou paginação. É parâmetro que transforma amostra em
 * ferramenta — no dia em que uma delas aceitar `search`, a conta gratuita vira
 * um buscador de mercado grátis sem que o limite de 20 mude uma linha.
 *
 * O throttle é mais apertado que o global. Não é defesa de dado (não há dado
 * novo a extrair de um conjunto fixo), é defesa de infraestrutura: são as
 * únicas rotas autenticadas que uma conta que nunca pagou consegue chamar.
 */
@ApiTags('free')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, FreePlanGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('free')
export class FreeController {
  constructor(private readonly free: FreeSampleService) {}

  @Get('sample')
  @ApiOperation({
    summary: 'Amostra da conta gratuita (fixa por 7 dias, igual para todos)',
  })
  sample(@CurrentUser() user: AuthUser) {
    // O usuário entra só para marcar os favoritos; o conjunto não muda com ele.
    return this.free.snapshot(user.id);
  }

  @Get('favorites')
  @ApiOperation({ summary: 'Favoritos desta conta, dentro da amostra vigente' })
  favorites(@CurrentUser() user: AuthUser) {
    return this.free.listarFavoritos(user.id);
  }

  @Post('products/:id/favorite')
  @ApiOperation({ summary: 'Favorita/desfavorita — 403 fora da amostra' })
  toggleFavorite(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.free.alternarFavorito(user.id, id);
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Detalhe reduzido — 403 se o id não está na amostra' })
  product(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.free.produto(id, user.id);
  }

  @Get('videos/:id')
  @ApiOperation({ summary: 'Detalhe reduzido — 403 se o id não está na amostra' })
  video(@Param('id', ParseUUIDPipe) id: string) {
    return this.free.video(id);
  }
}
