import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A que parte do produto esta chamada serviu.
 *
 * É a chave do relatório: margem não se apura por modelo (o mesmo Opus atende
 * roteiro e consolidação de base) nem por usuário — se apura por recurso
 * vendido, que é a unidade que tem preço.
 */
export type CostFeature =
  | 'script'
  | 'campaign'
  | 'analyze'
  | 'transcribe'
  | 'live_extract'
  | 'live_reply';

/** Em que moeda o cliente pagou por esta chamada. */
export type ChargedUnit = 'credit' | 'live_minute' | 'none';

/**
 * Uma chamada de IA e o que ela custou de verdade.
 *
 * A tabela de preços do `billing.config` é toda construída sobre estimativas de
 * pior caso feitas à mão, e estimativa à mão envelhece: o fornecedor reajusta,
 * o prompt engorda, o cache pega menos do que se supunha. Esta tabela é o
 * contraditório — o custo que a própria API reportou, ao lado do que foi
 * cobrado, para que a pergunta "a margem ainda está de pé?" tenha resposta com
 * dado em vez de fé.
 *
 * Guarda tokens e não só o total em reais porque o preço do fornecedor muda:
 * com os tokens, o histórico pode ser reapurado com a tabela nova; com o valor
 * fechado, não.
 */
@Entity('ai_cost_events')
export class AiCostEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nulo em rotina interna (cron, seed) — nem toda chamada tem dono. */
  @Index('IDX_ai_cost_events_userId')
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Index('IDX_ai_cost_events_feature')
  @Column()
  feature: CostFeature;

  @Column()
  model: string;

  @Column('int', { default: 0 })
  inputTokens: number;

  @Column('int', { default: 0 })
  outputTokens: number;

  @Column('int', { default: 0 })
  cacheReadTokens: number;

  @Column('int', { default: 0 })
  cacheWriteTokens: number;

  /** Segundos de áudio, quando a chamada é de transcrição. */
  @Column('int', { default: 0 })
  audioSeconds: number;

  /** Custo real da chamada, em BRL, pela tabela vigente no momento. */
  @Column({ type: 'numeric', precision: 12, scale: 6 })
  costBrl: string;

  @Column({ default: 'none' })
  chargedUnit: ChargedUnit;

  /** Quanto foi cobrado do cliente na moeda acima (créditos ou minutos). */
  @Column('int', { default: 0 })
  chargedAmount: number;

  @Index('IDX_ai_cost_events_createdAt')
  @CreateDateColumn()
  createdAt: Date;
}
