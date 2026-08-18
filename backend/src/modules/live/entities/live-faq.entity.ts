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
import { LiveProduct, LiveProductOrigin } from './live-product.entity';
import { LiveSession } from './live-session.entity';

/**
 * O que a entrada responde:
 *
 *  - `faq`: pergunta direta ("chega quando?", "tem PIX?");
 *  - `objecao`: o que trava a compra e precisa de contorno ("tá caro");
 *  - `politica`: regra da loja (troca, garantia, prazo) — vale para a live toda.
 */
export type LiveFaqKind = 'faq' | 'objecao' | 'politica';

/** Perguntas, objeções e políticas extraídas da live. */
@Entity('live_faq')
export class LiveFaq {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_live_faq_liveSessionId')
  @Column('uuid')
  liveSessionId: string;

  /**
   * Relações declaradas só para o banco: nada as carrega com `relations`, mas
   * as chaves estrangeiras existem desde a migração. Sem declará-las aqui, a
   * checagem de drift do CI pede para removê-las a cada build — e os nomes são
   * explícitos porque o nome em hash do TypeORM não bate com o da migração.
   */
  @ManyToOne(() => LiveSession, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'liveSessionId',
    foreignKeyConstraintName: 'FK_live_faq_session',
  })
  liveSession?: LiveSession;

  /**
   * Opcional de propósito: política de troca e prazo de entrega não pertencem
   * a nenhum produto. Apagar o produto não pode levar junto a resposta, daí o
   * `SET NULL` — ela vira uma resposta geral da live.
   */
  @Index('IDX_live_faq_liveProductId')
  @Column({ type: 'uuid', nullable: true })
  liveProductId: string | null;

  @ManyToOne(() => LiveProduct, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'liveProductId',
    foreignKeyConstraintName: 'FK_live_faq_product',
  })
  liveProduct?: LiveProduct;

  @Index('IDX_live_faq_userId')
  @Column('uuid')
  userId: string;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text' })
  answer: string;

  @Column({ default: 'faq' })
  kind: LiveFaqKind;

  @Column({ default: 'ia' })
  origin: LiveProductOrigin;

  /** Maior primeiro: desempata quando duas respostas servem à mesma pergunta. */
  @Column({ type: 'int', default: 0 })
  priority: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
