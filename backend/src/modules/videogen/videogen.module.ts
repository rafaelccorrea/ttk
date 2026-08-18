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
 * dinheiro.
 *
 * Sem `HIGGSFIELD_DRIVER` a escolha é por DETECÇÃO, e não por um padrão fixo. A
 * primeira versão deste arquivo assumia `cli`, e o efeito foi imediato ao subir:
 * o servidor não tinha a CLI nem a credencial, e uma feature que estava quebrada
 * por falta de crédito do fornecedor passou a estar quebrada por configuração
 * nossa — mesma tela para o cliente, causa muito mais difícil de achar. Ativar
 * um caminho que exige infraestrutura ausente não pode ser o comportamento de
 * quem não configurou nada.
 *
 * Com detecção, quem manda é o que existe: havendo credencial de CLI, ela vence,
 * porque é a carteira com saldo. Não havendo, cai na API, que é o que o sistema
 * sempre fez. `HIGGSFIELD_DRIVER` continua valendo e ganha de tudo, para forçar
 * um lado quando os dois estiverem disponíveis.
 *
 * A escolha é registrada no boot de propósito. "Por que a geração parou" e "por
 * que o crédito não baixou onde eu esperava" são as duas perguntas que esta
 * linha responde, e ela precisa estar no log de quem for procurar.
 */
function escolherGerador(config: ConfigService): GeradorDeMidia {
  const logger = new Logger('GeradorDeMidia');
  const pedido = config.get<string>('HIGGSFIELD_DRIVER')?.toLowerCase();
  const cli = new HiggsfieldCliService(config);
  const usarCli = pedido ? pedido === 'cli' : cli.isConfigured;

  if (usarCli) {
    logger.log(
      cli.isConfigured
        ? 'Carteira: plano, via CLI.'
        : 'Carteira: plano, via CLI — SEM credencial em HIGGSFIELD_CREDENTIALS_PATH, geração desligada.',
    );
    return cli;
  }

  const api = new HiggsfieldService(config);
  logger.log(
    `Carteira: API (platform.higgsfield.ai)` +
      (api.isConfigured ? '' : ' — SEM CHAVE, geração desligada') +
      (pedido ? '' : ' — sem credencial de CLI, então este é o caminho por detecção.'),
  );
  return api;
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
