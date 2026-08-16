import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShowcaseService } from './showcase.service';

/**
 * A única rota de dado sem autenticação do PikPok.
 *
 * Ela existe porque o produto passou a cobrar na entrada e alguma prova precisa
 * viver antes do cadastro — mas por ser pública é também a de maior risco, e
 * por isso entrega uma amostra reduzida (ver ShowcaseService) com throttle
 * próprio, mais apertado que o global.
 */
@ApiTags('showcase')
@Controller('showcase')
export class ShowcaseController {
  constructor(private readonly showcase: ShowcaseService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Amostra pública da landing (sem login, defasada e reduzida)',
  })
  snapshot() {
    return this.showcase.snapshot();
  }
}
