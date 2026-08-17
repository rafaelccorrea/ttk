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
 * Como a resposta chega ao chat.
 *
 *  - `painel`: aparece na tela do vendedor para ele copiar ou ler em voz alta,
 *    e nada é postado no TikTok;
 *  - `auto`: o app desktop digita e envia a resposta no chat da live.
 *
 * A coluna nasceu na fase anterior com um valor só justamente para que esta
 * fase fosse acrescentar um literal, e não um ALTER numa tabela já cheia de
 * transmissões. Toda run começa em `painel`: ligar o automático é um ato
 * explícito, feito com o termo de risco aceito (ver `liveAutoAcceptedAt`), e
 * qualquer caminho de degradação — falha de entrega, saldo, queda — volta para
 * cá, porque painel é o modo que não pode dar errado.
 */
export type LiveRunMode = 'painel' | 'auto';

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
   * O funil do modo automático, e a razão de ele existir separado de
   * `repliesGenerated`: gerar resposta e conseguir postá-la no chat do TikTok
   * são dois problemas distintos, e só o segundo depende de uma interface que
   * não é nossa. Um par saudável (muitas enviadas, poucas falhas) e um par
   * doente (falhas subindo) levam a decisões opostas — insistir ou cair para o
   * painel — e sem os dois contadores na própria run o painel não teria como
   * mostrar isso ao vendedor enquanto a live corre.
   */
  @Column({ type: 'int', default: 0 })
  repliesSent: number;

  @Column({ type: 'int', default: 0 })
  deliveryFailures: number;

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
