import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LiveRun } from './live-run.entity';

/**
 * O que aconteceu com a mensagem:
 *
 *  - `nova`: entrou e ainda não passou pelo copiloto;
 *  - `respondida`: virou uma resposta no painel;
 *  - `escalada`: o modelo não teve confiança suficiente e passou ao humano;
 *  - `duplicada`: alguém já perguntou a mesma coisa nesta run (o cluster
 *    original é que carrega o `repeatCount`);
 *  - `ignorada`: não era pergunta — saudação, emoji, spam.
 */
export type LiveChatMessageStatus =
  | 'nova'
  | 'respondida'
  | 'escalada'
  | 'duplicada'
  | 'ignorada';

/** Uma mensagem do chat da transmissão, como o app desktop a entregou. */
@Entity('live_chat_messages')
/*
 * O par (run, id externo) é único porque a reconexão do chat PRECISA ser
 * idempotente: quando a conexão cai — e cai, é uma live de horas numa rede
 * doméstica — o app não sabe qual foi a última mensagem que o backend chegou a
 * gravar, então ele reenvia a janela inteira que tem em mãos. Sem esta trava, a
 * mesma pergunta entraria duas vezes, seria respondida duas vezes e cobraria
 * duas vezes. Com ela, o reenvio simplesmente colide e o insert vira no-op.
 *
 * O escopo é a run, não global: o TikTok não promete id de mensagem único entre
 * salas, e uma colisão global bloquearia a live de outro vendedor.
 */
@Index(
  'IDX_live_chat_messages_external',
  ['liveRunId', 'externalMessageId'],
  { unique: true },
)
/*
 * A janela de comparação do dedup é "as mensagens recentes DESTA run", e é o
 * primeiro filtro de toda consulta de irmãs. Sem o par (run, recebida em), o
 * Postgres pega o índice de `liveRunId` e ordena à mão dezenas de milhares de
 * linhas a cada lote de 800ms.
 */
@Index('IDX_live_chat_messages_run_receivedAt', ['liveRunId', 'receivedAt'])
/*
 * O GIN trigram sobre `text` é declarado AQUI, e não só na migration, porque o
 * TypeORM não sabe escrever um índice com `USING gin (... gin_trgm_ops)`: sem
 * esta declaração ele não encontra o índice do banco entre os da entidade e
 * emite um `DROP INDEX` a cada `schema:log` — o drift-check do CI quebra e, pior,
 * um `schema:sync` acidental derrubaria o índice que sustenta o dedup.
 * `synchronize: false` é exatamente o contrato: "este índice existe, é da
 * migration, não mexa".
 */
@Index('IDX_live_chat_messages_text_trgm', { synchronize: false })
export class LiveChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_live_chat_messages_liveRunId')
  @Column('uuid')
  liveRunId: string;

  /**
   * Declarada só para o banco (ver `LiveRun.knowledgeSession`). CASCADE aqui,
   * ao contrário da base de conhecimento: o chat não tem vida fora da run que o
   * recebeu, e são dezenas de milhares de linhas por transmissão.
   */
  @ManyToOne(() => LiveRun, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'liveRunId',
    foreignKeyConstraintName: 'FK_live_chat_messages_run',
  })
  liveRun?: LiveRun;

  @Index('IDX_live_chat_messages_userId')
  @Column('uuid')
  userId: string;

  /** Id da mensagem no TikTok — é a metade útil da chave de idempotência. */
  @Column()
  externalMessageId: string;

  /**
   * Identificação do autor SEM guardar quem ele é: sha256 do username com um
   * salt próprio da run. Serve para o único uso legítimo que temos — saber que
   * duas mensagens vieram da mesma pessoa dentro da mesma transmissão, o que
   * separa "cinquenta pessoas perguntando o preço" de "uma pessoa insistindo".
   *
   * O salt ser por run é o ponto: o mesmo espectador em duas lives gera hashes
   * diferentes, então isto não vira um identificador de comportamento que
   * atravessa transmissões. E o username em claro nunca entra no banco — não
   * temos base legal para manter dado de terceiro que só passou pelo chat, e
   * hash com salt descartável é o que torna o vazamento desta tabela inócuo
   * para quem estava assistindo.
   */
  @Column()
  authorHash: string;

  @Column({ type: 'text' })
  text: string;

  /**
   * Quando a mensagem apareceu no chat, segundo o cliente — não quando chegou
   * ao backend. Numa reconexão o app despeja de uma vez o que acumulou, e é
   * este campo que preserva a ordem real da conversa.
   */
  @Column({ type: 'timestamptz' })
  receivedAt: Date;

  @Column({ type: 'boolean', default: false })
  isQuestion: boolean;

  /**
   * Chave do agrupamento de perguntas equivalentes. "qnt custa", "quanto é o
   * azul?" e "preço?" são a mesma dúvida, e responder cada uma isoladamente
   * gasta modelo, gasta minuto e enche o painel de repetição. O cluster junta
   * tudo numa resposta só, com `repeatCount` mostrando o tamanho da fila.
   */
  @Index('IDX_live_chat_messages_clusterKey')
  @Column({ type: 'varchar', nullable: true })
  clusterKey: string | null;

  @Column({ default: 'nova' })
  status: LiveChatMessageStatus;

  /** Quantas mensagens caíram neste cluster — 1 é a própria. */
  @Column({ type: 'int', default: 1 })
  repeatCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
