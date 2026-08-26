import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LiveChatMessage } from './live-chat-message.entity';
import { LiveRun } from './live-run.entity';

/**
 * O veredito do copiloto sobre a própria resposta:
 *
 *  - `enviar`: respondeu com confiança, o painel mostra em destaque;
 *  - `escalar`: gerou algo, mas a base não sustenta — o vendedor precisa olhar
 *    antes de falar;
 *  - `silenciar`: melhor não responder (pergunta fora do catálogo, provocação,
 *    assunto que não é da live).
 *
 * Na fase painel nenhum dos três posta nada no TikTok: a diferença é só o peso
 * que a resposta ganha na tela do vendedor. Os nomes já valem para a fase 2,
 * quando `enviar` passa a significar envio de verdade.
 */
export type LiveReplyDecision = 'enviar' | 'escalar' | 'silenciar';

/**
 * O que aconteceu com a resposta DEPOIS de o copiloto decidir por ela:
 *
 *  - `nao_aplica`: não havia envio a fazer — run em modo painel, ou decisão que
 *    não é `enviar`;
 *  - `pendente`: está na fila esperando o app digitar no chat da live;
 *  - `enviada`: o app confirmou que o comentário saiu;
 *  - `falhou`: o app tentou e não conseguiu (campo bloqueado, sessão caída,
 *    verificação na tela) — `failureReason` diz o quê;
 *  - `cancelada`: ficou velha demais na fila e foi descartada antes de sair.
 *
 * `nao_aplica` é o default, e a escolha é sobre MÉTRICA, não sobre semântica.
 * Quase toda resposta do produto nasce em modo painel, onde nada é enviado; se
 * ela nascesse `pendente` ficaria pendente para sempre, e a taxa de entrega — a
 * única forma de saber se o modo automático está funcionando na casa do
 * vendedor — leria como um sistema permanentemente atolado.
 */
export type LiveReplyDeliveryStatus =
  | 'nao_aplica'
  | 'pendente'
  | 'enviada'
  | 'falhou'
  | 'cancelada';

/** Uma resposta gerada pelo copiloto para uma mensagem do chat. */
@Entity('live_replies')
export class LiveReply {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_live_replies_liveRunId')
  @Column('uuid')
  liveRunId: string;

  /** Declarada só para o banco (ver `LiveRun.knowledgeSession`). */
  @ManyToOne(() => LiveRun, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'liveRunId',
    foreignKeyConstraintName: 'FK_live_replies_run',
  })
  liveRun?: LiveRun;

  /**
   * Uma mensagem tem no máximo uma resposta, e quem garante isso é o banco.
   *
   * O dedup do lote e a janela de repetição vivem na memória de um processo, e
   * o lote é processado fora da requisição — dois em voo ao mesmo tempo passam
   * juntos pela checagem e gravam duas respostas para a mesma pergunta: duas
   * linhas no painel do vendedor e duas linhas de custo. Só a restrição única
   * sobrevive à concorrência e a mais de uma instância.
   */
  @Index('IDX_live_replies_chatMessageId', { unique: true })
  @Column('uuid')
  chatMessageId: string;

  @ManyToOne(() => LiveChatMessage, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'chatMessageId',
    foreignKeyConstraintName: 'FK_live_replies_message',
  })
  chatMessage?: LiveChatMessage;

  @Column('uuid')
  userId: string;

  @Column({ type: 'text' })
  text: string;

  /**
   * Quanto o copiloto confia no que escreveu, de 0 a 1. É o número que decide
   * entre `enviar` e `escalar`, e o que permite calibrar o corte depois de ver
   * o que o vendedor de fato copiou.
   */
  @Column({ type: 'numeric', precision: 3, scale: 2 })
  confidence: string;

  /** Modelo usado — o corte de confiança não é comparável entre modelos. */
  @Column()
  model: string;

  @Column()
  decision: LiveReplyDecision;

  /**
   * Os produtos da base que sustentaram a resposta. Guardados por id para que a
   * resposta continue rastreável até a origem: quando o vendedor reclamar de um
   * preço errado no painel, é isto que diz qual item do catálogo corrigir.
   */
  // Sem o cast `::uuid[]` no default: o TypeORM lê o default do Postgres já
  // normalizado e compara com o literal declarado aqui — com o cast a
  // comparação nunca bate e o drift-check do CI pede um `SET DEFAULT` eterno.
  // Mesmo motivo de `user_products.images`.
  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  sourceProductIds: string[];

  /**
   * Quanto tempo levou da mensagem à resposta pronta. Numa live, resposta certa
   * que chega depois de o assunto passar não vale nada — a latência é critério
   * de aceitação da fase, não estatística de rodapé.
   */
  @Column({ type: 'int', default: 0 })
  latencyMs: number;

  /**
   * O custo desta resposta, em tokens — a PARTE dela na chamada do lote
   * (total do lote dividido pelas perguntas que foram juntas). Nulo quando
   * não houve modelo (`faq`, `reaproveitada`, `outra_live`). É o que permite
   * a pergunta "quanto custa uma live, por plano" sem abrir a fatura da OpenAI.
   */
  @Column({ type: 'int', nullable: true })
  promptTokens: number | null;

  @Column({ type: 'int', nullable: true })
  cachedTokens: number | null;

  @Column({ type: 'int', nullable: true })
  completionTokens: number | null;

  /**
   * Hash da base com que a resposta foi gerada. É a chave do reaproveitamento
   * ENTRE lives: a mesma pergunta, com a mesma base byte a byte, tem a mesma
   * resposta — em qualquer dia. Base editada muda o hash e invalida tudo.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  baseHash: string | null;

  /**
   * Quando o vendedor copiou a resposta do painel. É a métrica de qualidade
   * desta fase inteira: sem envio automático, a única evidência de que o
   * copiloto acertou é o humano ter escolhido usar o que ele escreveu. Nulo
   * significa que a resposta apareceu e foi ignorada.
   */
  @Column({ type: 'timestamptz', nullable: true })
  copiedAt: Date | null;

  /**
   * O ciclo de vida da entrega. Ver `LiveReplyDeliveryStatus` para o porquê de
   * o default ser `nao_aplica`.
   */
  @Index('IDX_live_replies_deliveryStatus')
  @Column({ default: 'nao_aplica' })
  deliveryStatus: LiveReplyDeliveryStatus;

  /**
   * Quando o app confirmou que o comentário saiu. Separado de `createdAt` de
   * propósito: a distância entre os dois é o tempo de fila, e é ele que diz se
   * o envio automático está chegando enquanto o assunto ainda está no ar ou
   * respondendo o chat de dois minutos atrás.
   */
  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  /** Por que não saiu. Vale para `falhou` e para `cancelada`. */
  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  /**
   * Quantas vezes se tentou entregar esta resposta. Uma falha isolada é ruído
   * de UI do TikTok; várias na mesma live são sinal de que a automação foi
   * barrada, e é isso que decide voltar a run para o modo painel em vez de
   * seguir insistindo — insistir é justamente o que chama atenção para a conta.
   */
  @Column({ type: 'int', default: 0 })
  deliveryAttempts: number;

  @CreateDateColumn()
  createdAt: Date;
}
