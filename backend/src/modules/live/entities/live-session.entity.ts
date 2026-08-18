import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Estados na ordem real do pipeline — a sessão anda sempre para frente:
 *
 *  - `rascunho`: existe o registro, o áudio ainda não foi processado;
 *  - `transcrevendo`: o Whisper está lendo a gravação (é a etapa longa, horas
 *    de live viram texto);
 *  - `extraindo`: a transcrição já existe e o Claude está tirando dela os
 *    produtos, preços, objeções e o FAQ;
 *  - `pronta`: a base de conhecimento está montada e editável na tela;
 *  - `erro`: alguma das etapas falhou e `errorMessage` diz qual.
 */
export type LiveSessionStatus =
  | 'rascunho'
  | 'transcrevendo'
  | 'extraindo'
  | 'pronta'
  | 'erro';

/**
 * De onde veio o conteúdo: `gravada` é o caminho normal (o vendedor sobe uma
 * live já feita), `manual` é a sessão criada vazia para quem prefere digitar
 * a base de conhecimento em vez de extraí-la.
 */
export type LiveSessionSourceKind = 'gravada' | 'manual';

/** Uma live enviada pelo vendedor. É a raiz da base de conhecimento. */
@Entity('live_sessions')
export class LiveSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_live_sessions_userId')
  @Column('uuid')
  userId: string;

  @Column()
  title: string;

  @Column({ default: 'rascunho' })
  status: LiveSessionStatus;

  @Column({ default: 'gravada' })
  sourceKind: LiveSessionSourceKind;

  /** Chave do objeto no S3 — o áudio extraído da gravação, não o vídeo. */
  @Column({ type: 'text', nullable: true })
  audioKey: string | null;

  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  /** Transcrição completa do Whisper, crua. É a entrada da extração. */
  @Column({ type: 'text', nullable: true })
  transcript: string | null;

  @Column({ type: 'int', default: 0 })
  creditsSpent: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /**
   * Quando a etapa atual começou. É o que permite o cron reabrir uma sessão
   * travada: transcrever uma live de 4h demora, e sem uma marca de início não
   * dá para distinguir "ainda está rodando" de "o processo morreu no meio" —
   * a sessão ficaria presa em `transcrevendo` para sempre.
   */
  @Column({ type: 'timestamptz', nullable: true })
  processingStartedAt: Date | null;

  /**
   * Cobranças já debitadas que ainda NÃO foram pagas com entrega.
   *
   * O pipeline debita antes de trabalhar (é o padrão do `charge`), e quando o
   * processo morre no meio — deploy, OOM, restart — não há exceção nenhuma para
   * disparar o estorno do `withCharge`: o crédito simplesmente sumiu. Estes dois
   * campos são o registro durável do que está em aberto, para que o cron que
   * varre sessões mortas consiga devolver exatamente o que foi cobrado. Voltam a
   * zero assim que a base é gravada (aí a cobrança virou entrega) ou assim que o
   * estorno acontece.
   */
  @Column({ type: 'int', default: 0 })
  pendingTranscribeBlocks: number;

  @Column({ type: 'boolean', default: false })
  pendingExtractCharge: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
