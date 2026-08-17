import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ACTION_PRICES,
  BillableAction,
  CREDIT_VALUE_BRL,
  LIVE_COST_PER_MINUTE_BRL,
  MIN_MARGIN,
} from '../billing/billing.config';
import {
  AiCostEvent,
  ChargedUnit,
  CostFeature,
} from './entities/ai-cost-event.entity';
import { costBrl, TokenUsage, whisperCostBrl } from './model-pricing';

/** Uma linha do relatório de margem: o que custou contra o que entrou. */
export interface MargemPorRecurso {
  feature: CostFeature;
  chamadas: number;
  custoBrl: number;
  receitaBrl: number;
  margem: number | null;
  custoMedioBrl: number;
}

/**
 * O contraditório da tabela de preços.
 *
 * Registrar não pode atrapalhar quem está sendo medido: toda gravação aqui é
 * best-effort e engole o próprio erro. Perder uma linha de telemetria é um
 * relatório levemente subestimado; derrubar a geração de um roteiro porque a
 * telemetria falhou é perder o produto para salvar a métrica.
 */
@Injectable()
export class AiCostService {
  private readonly logger = new Logger(AiCostService.name);

  constructor(
    @InjectRepository(AiCostEvent)
    private readonly eventos: Repository<AiCostEvent>,
  ) {}

  /** Registra uma chamada de modelo de linguagem. */
  async registrar(
    feature: CostFeature,
    model: string,
    usage: TokenUsage,
    opts: {
      userId?: string | null;
      chargedUnit?: ChargedUnit;
      chargedAmount?: number;
    } = {},
  ): Promise<void> {
    try {
      await this.eventos.save(
        this.eventos.create({
          userId: opts.userId ?? null,
          feature,
          model,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.cacheWriteTokens ?? 0,
          costBrl: costBrl(model, usage).toFixed(6),
          chargedUnit: opts.chargedUnit ?? 'none',
          chargedAmount: opts.chargedAmount ?? 0,
        }),
      );
    } catch (e) {
      this.logger.warn(`Não foi possível registrar o custo de ${feature}: ${e}`);
    }
  }

  /** Registra uma transcrição, que o Whisper cobra por minuto de áudio. */
  async registrarTranscricao(
    durationSeconds: number,
    opts: { userId?: string | null; chargedAmount?: number } = {},
  ): Promise<void> {
    try {
      await this.eventos.save(
        this.eventos.create({
          userId: opts.userId ?? null,
          feature: 'transcribe',
          model: 'whisper-1',
          audioSeconds: Math.round(durationSeconds),
          costBrl: whisperCostBrl(durationSeconds).toFixed(6),
          chargedUnit: 'credit',
          chargedAmount: opts.chargedAmount ?? 0,
        }),
      );
    } catch (e) {
      this.logger.warn(`Não foi possível registrar a transcrição: ${e}`);
    }
  }

  /**
   * Margem realizada por recurso num intervalo.
   *
   * A receita é reconstruída da moeda em que cada chamada foi cobrada: crédito
   * vale `CREDIT_VALUE_BRL` de face, e minuto de live vale o preço médio do
   * add-on. É por isso que `chargedUnit` e `chargedAmount` ficam gravados na
   * própria linha — sem eles, cruzar custo com receita depois viraria
   * adivinhação sobre qual tabela de preços valia naquele dia.
   */
  async margemPorRecurso(
    desde: Date,
    ate: Date,
    precoMedioDoMinutoBrl: number,
  ): Promise<MargemPorRecurso[]> {
    const linhas = await this.eventos
      .createQueryBuilder('e')
      .select('e.feature', 'feature')
      .addSelect('COUNT(*)::int', 'chamadas')
      .addSelect('SUM(e."costBrl")', 'custo')
      .addSelect(
        `SUM(CASE WHEN e."chargedUnit" = 'credit' THEN e."chargedAmount" ELSE 0 END)::int`,
        'creditos',
      )
      .addSelect(
        `SUM(CASE WHEN e."chargedUnit" = 'live_minute' THEN e."chargedAmount" ELSE 0 END)::int`,
        'minutos',
      )
      .where('e."createdAt" BETWEEN :desde AND :ate', { desde, ate })
      .groupBy('e.feature')
      .getRawMany();

    return linhas.map((l) => {
      const custoBrl = Number(l.custo ?? 0);
      const receitaBrl =
        Number(l.creditos ?? 0) * CREDIT_VALUE_BRL +
        Number(l.minutos ?? 0) * precoMedioDoMinutoBrl;
      const chamadas = Number(l.chamadas ?? 0);
      return {
        feature: l.feature as CostFeature,
        chamadas,
        custoBrl: Number(custoBrl.toFixed(2)),
        receitaBrl: Number(receitaBrl.toFixed(2)),
        // Sem custo medido não há margem: devolver 0 ou Infinity aqui viraria
        // "está tudo bem" no relatório, que é a leitura errada.
        margem: custoBrl > 0 ? Number((receitaBrl / custoBrl).toFixed(2)) : null,
        custoMedioBrl: chamadas ? Number((custoBrl / chamadas).toFixed(4)) : 0,
      };
    });
  }

  /**
   * As ações cujo custo MEDIDO já passou do custo que foi PRECIFICADO.
   *
   * É o alarme que a estimativa à mão não dá: `billing.config` afirma um pior
   * caso por ação, e aqui se vê o pior caso que aconteceu. Quando o medido
   * ultrapassa o estimado, o preço parou de refletir a realidade — e a margem
   * está sendo corroída em silêncio, com a fatura chegando depois.
   */
  async acoesAcimaDoEstimado(
    desde: Date,
  ): Promise<Array<{ feature: string; piorCasoMedidoBrl: number; estimadoBrl: number }>> {
    const linhas = await this.eventos
      .createQueryBuilder('e')
      .select('e.feature', 'feature')
      .addSelect('MAX(e."costBrl")', 'pior')
      .where('e."createdAt" >= :desde', { desde })
      .groupBy('e.feature')
      .getRawMany();

    const estimadoDe = (feature: string): number | null => {
      if (feature === 'live_reply') {
        // O motor ao vivo é precificado por MINUTO, não por chamada.
        return LIVE_COST_PER_MINUTE_BRL;
      }
      const acao = feature as BillableAction;
      return ACTION_PRICES[acao]?.worstCaseCostBrl ?? null;
    };

    return linhas
      .map((l) => {
        const estimado = estimadoDe(l.feature);
        const pior = Number(l.pior ?? 0);
        return estimado !== null && pior > estimado
          ? {
              feature: l.feature,
              piorCasoMedidoBrl: Number(pior.toFixed(4)),
              estimadoBrl: estimado,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  /** A margem mínima que o negócio exige — para o relatório comparar. */
  get margemMinima(): number {
    return MIN_MARGIN;
  }
}
