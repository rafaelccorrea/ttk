import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { GeneratedMedia } from './entities/generated-media.entity';
import { GERADOR_DE_MIDIA, type GeradorDeMidia } from './gerador-de-midia';
import { HiggsfieldCliService } from './higgsfield-cli.service';
import { HiggsfieldSentinelaService } from './higgsfield-sentinela.service';
import { HiggsfieldService } from './higgsfield.service';
import { VideogenController } from './videogen.controller';
import { VideogenService } from './videogen.service';
import { SingleFlightInterceptor } from '../../common/interceptors/single-flight.interceptor';

/**
 * Escolhe de qual CARTEIRA da Higgsfield a geração vai sair.
 *
 * `api` fala com `platform.higgsfield.ai` por chave de servidor; `cli` gasta os
 * créditos do plano pela linha de comando. São saldos separados que não se
 * comunicam, então isto não é preferência de implementação — é de onde sai o
 * dinheiro. O padrão é `cli` porque é a carteira que tem saldo; quando a de API
 * for recarregada, `HIGGSFIELD_DRIVER=api` volta atrás sem tocar em código.
 *
 * A escolha é registrada no boot de propósito. "Por que a geração parou" e "por
 * que o crédito não baixou onde eu esperava" são as duas perguntas que esta
 * linha responde, e ela precisa estar no log de quem for procurar.
 */
function escolherGerador(config: ConfigService): GeradorDeMidia {
  const logger = new Logger('GeradorDeMidia');
  const driver = (config.get<string>('HIGGSFIELD_DRIVER') ?? 'cli').toLowerCase();

  if (driver === 'api') {
    const api = new HiggsfieldService(config);
    logger.log(
      `Carteira: API (platform.higgsfield.ai)${api.isConfigured ? '' : ' — SEM CHAVE, geração desligada'}`,
    );
    return api;
  }

  const cli = new HiggsfieldCliService(config);
  logger.log(
    cli.isConfigured
      ? 'Carteira: plano, via CLI.'
      : 'Carteira: plano, via CLI — SEM credencial em HIGGSFIELD_CREDENTIALS_PATH, geração desligada.',
  );
  return cli;
}

@Module({
  imports: [TypeOrmModule.forFeature([GeneratedMedia]), UsersModule, BillingModule],
  controllers: [VideogenController],
  providers: [
    SingleFlightInterceptor,
    VideogenService,
    {
      provide: GERADOR_DE_MIDIA,
      useFactory: escolherGerador,
      inject: [ConfigService],
    },
    // Exposto à parte para a sentinela poder sondar a autenticação da CLI sem
    // depender de qual carteira está ativa no momento.
    HiggsfieldCliService,
    HiggsfieldSentinelaService,
  ],
  // As campanhas geram por aqui, pelos mesmos serviços — nenhuma chamada à
  // Higgsfield fora deste caminho, para a cobrança e o estorno valerem sempre.
  exports: [VideogenService, HiggsfieldCliService],
})
export class VideogenModule {}
