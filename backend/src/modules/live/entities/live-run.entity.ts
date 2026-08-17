import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LiveSession } from './live-session.entity';

/**
 * Estados de uma transmissão, na ordem em que acontecem:
 *
 *  - `conectando`: o app desktop já abriu a run, mas ainda não recebeu chat;
 *  - `ativa`: chegando mensagem e o painel respondendo;
 *  - `encerrada`: fim normal — o vendedor desligou ou a live acabou;
 *  - `erro`: a conexão caiu de vez e `errorMessage` diz o motivo.
 */
export type LiveRunStatus = 'conectando' | 'ativa' | 'encerrada' | 'erro';

/**
 * Como a resposta chega ao chat. Nesta fase só existe `painel`: a resposta
 * aparece na tela do vendedor para ele copiar ou ler em voz alta, e nada é
 * postado no TikTok. `auto` — envio direto — é a fase 2.
 *
 * A coluna já nasce aqui, com um único valor possível, de propósito: a fase 2
 * só acrescenta o segundo valor, enquanto criá-la depois seria um ALTER numa
 * tabela já cheia de transmissões, com backfill e uma janela em que run antiga
 * e run nova não têm o mesmo formato.
 */
export type LiveRunMode = 'painel';

/**
 * Uma transmissão ao vivo acompanhada pelo copiloto.
 *
 * Separada de `live_sessions` pelo mesmo motivo que a base de conhecimento é
 * separada da gravação: o catálogo extraído uma vez serve dezenas de lives
 * seguidas. Amarrar transmissão e base obrigaria a reprocessar (e repagar) a
 * gravação a cada noite para chegar exatamente no mesmo conhecimento. Aqui a
 * run só aponta para a base que vai consultar.
 */
@Entity('live_runs')
export class LiveRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_live_runs_userId')
  @Column('uuid')
  userId: string;

  /** A base de conhecimento que esta transmissão consulta para responder. */
  @Column('uuid')
  knowledgeSessionId: string;

  /**
   * Relação declarada só para o banco — nada carrega a sessão com `relations`,
   * mas sem declará-la aqui o drift-check do CI pediria para remover a chave
   * estrangeira a cada build. O nome é explícito porque o hash que o TypeORM
   * assumiria não bate com o que a migration cria.
   *
   * RESTRICT, e não CASCADE: a base é editável e descartável, o histórico do
   * que foi respondido ao vivo não é. Apagar um catálogo velho não pode levar
   * junto o registro de quantas perguntas o copiloto respondeu e como.
   */
  @ManyToOne(() => LiveSession, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'knowledgeSessionId',
    foreignKeyConstraintName: 'FK_live_runs_session',
  })
  knowledgeSession?: LiveSession;

  /** Identificadores da sala no TikTok, quando o app consegue lê-los. */
  @Column({ type: 'varchar', nullable: true })
  tiktokRoomId: string | null;

  @Column({ type: 'varchar', nullable: true })
  tiktokUsername: string | null;

  @Column({ default: 'conectando' })
  status: LiveRunStatus;

  @Column({ default: 'painel' })
  mode: LiveRunMode;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  /**
   * Contadores do funil da transmissão, materializados na própria run em vez de
   * contados por agregação: são o que o painel mostra a cada poucos segundos
   * enquanto a live corre, e o que diz se o copiloto está entregando — quantas
   * das mensagens vistas viraram resposta e quantas caíram no humano.
   */
  @Column({ type: 'int', default: 0 })
  messagesSeen: number;

  @Column({ type: 'int', default: 0 })
  repliesGenerated: number;

  @Column({ type: 'int', default: 0 })
  escalations: number;

  /**
   * O relógio da cobrança. O copiloto queima minutos da carteira enquanto está
   * no ar, e a cobrança é incremental: a cada tique, debita-se o que passou
   * desde `lastChargedAt` e soma-se em `minutesCharged`. Guardar o total já
   * cobrado é o que impede a dobra quando a run é retomada depois de uma queda
   * de conexão — sem isso, reconectar recomeçaria a contagem do zero e o
   * vendedor pagaria de novo o tempo que já pagou.
   */
  @Column({ type: 'int', default: 0 })
  minutesCharged: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastChargedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
