import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AiJobStatus = 'na_fila' | 'rodando' | 'concluido' | 'falhou';

/**
 * Que tipo de trabalho é — a tela usa para saber em que página o resultado
 * aparece e o que fazer com `resultado` quando o job termina.
 */
export type AiJobTipo =
  | 'transcribe'
  | 'analyze'
  | 'script'
  | 'campaign_script'
  | 'campaign_assemble';

/**
 * Um trabalho de IA que roda em background, independente do request que o
 * pediu. A regra da casa: NENHUMA geração de IA pode morrer porque o usuário
 * fechou a aba — o request só cria a linha e devolve o id; a tela acompanha
 * pelo progresso global (`GET /jobs/ativos`) e reconecta ao voltar.
 *
 * `heartbeatAt` é batido pelo processo enquanto trabalha; o cron marca como
 * falhou (e estorna `estornoAcao`/`estornoQuantidade`) o que parou de bater,
 * porque isso só acontece quando o servidor morreu no meio.
 */
@Entity('ai_jobs')
export class AiJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_ai_jobs_user')
  @Column('uuid')
  userId: string;

  @Column({ length: 40 })
  tipo: AiJobTipo;

  /** O que aparece no indicador global ("Transcrevendo aula-3.mp4"). */
  @Column({ length: 200 })
  titulo: string;

  @Index('IDX_ai_jobs_status')
  @Column({ length: 20, default: 'na_fila' })
  status: AiJobStatus;

  @Column({ type: 'int', default: 0 })
  progresso: number;

  /** Etapa atual em linguagem de gente ("Ouvindo o áudio", "Escrevendo…"). */
  @Column({ type: 'text', nullable: true })
  etapa: string | null;

  /** Id do objeto ligado (campanha, roteiro…) para a tela navegar até ele. */
  @Column({ type: 'uuid', nullable: true })
  referenciaId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  resultado: unknown | null;

  @Column({ type: 'text', nullable: true })
  erro: string | null;

  /** Cobrança feita antes de rodar; é o que o cron devolve se o processo morrer. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  estornoAcao: string | null;

  @Column({ type: 'int', nullable: true })
  estornoQuantidade: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** Quando o usuário dispensou o aviso de concluído/falhou no indicador. */
  @Column({ type: 'timestamptz', nullable: true })
  dispensadoEm: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
