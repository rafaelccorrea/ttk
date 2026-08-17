import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiCostService } from './ai-cost.service';
import { AiCostEvent } from './entities/ai-cost-event.entity';

/**
 * Medição de custo real da IA.
 *
 * `@Global` de propósito, e é a única exceção do repo: qualquer serviço que
 * chame um modelo precisa registrar, e obrigar cada módulo a importar este aqui
 * garante que um dia alguém esqueça — e a chamada não medida é justamente a que
 * some do relatório de margem sem deixar rastro.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AiCostEvent])],
  providers: [AiCostService],
  exports: [AiCostService],
})
export class TelemetryModule {}
