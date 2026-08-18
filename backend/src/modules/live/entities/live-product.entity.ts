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
 * Quem colocou o produto na base. Isto é auditoria, não enfeite: a extração
 * erra, inventa preço e junta dois produtos num só. Precisa dar para saber
 * depois o que a IA escreveu e o que o vendedor corrigiu à mão — tanto para
 * confiar na base na hora de responder a live quanto para medir a qualidade
 * da própria extração.
 */
export type LiveProductOrigin = 'ia' | 'manual' | 'catalogo';

/** Um produto vendido na live, com tudo que o chat costuma perguntar. */
@Entity('live_products')
export class LiveProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_live_products_liveSessionId')
  @Column('uuid')
  liveSessionId: string;

  /**
   * Relação declarada só para o banco: nada no código carrega o produto com
   * `relations`, mas a chave estrangeira existe desde a migração. Sem declará-la
   * aqui, o TypeORM não sabe que ela existe e a checagem de drift do CI pede
   * para removê-la a cada build. O nome é explícito pelo mesmo motivo: o nome
   * em hash que o TypeORM assumiria não bate com o que a migração cria.
   */
  @ManyToOne(() => LiveSession, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'liveSessionId',
    foreignKeyConstraintName: 'FK_live_products_session',
  })
  liveSession?: LiveSession;

  @Index('IDX_live_products_userId')
  @Column('uuid')
  userId: string;

  @Column()
  name: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  priceBrl: string | null;

  /** Tamanhos, cores, kits — o que muda preço ou estoque dentro do produto. */
  // O default vai SEM o cast `::jsonb`: o TypeORM lê o default do Postgres já
  // normalizado (sem cast) e compara com o texto literal declarado aqui — com o
  // cast, a comparação nunca bate e a checagem de drift do CI pede um
  // `ALTER COLUMN SET DEFAULT` eterno. Mesmo motivo de `api_raw_responses`.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  variants: unknown[];

  @Column({ type: 'text', nullable: true })
  shippingInfo: string | null;

  @Column({ type: 'text', nullable: true })
  promo: string | null;

  /**
   * Como o público chama o produto no chat: "o azul", "aquele kit", "o de 200".
   * Ninguém digita o nome do catálogo. É por estes apelidos que a pergunta vai
   * casar com o produto certo na fase ao vivo, então eles valem tanto quanto o
   * nome oficial — e o vendedor pode acrescentar os que a IA não pegou.
   */
  // Sem o cast `::text[]`, pelo mesmo motivo do `variants` acima (e igual ao
  // que `user_products.images` já faz).
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  aliases: string[];

  /** Confiança da extração, de 0 a 1 — orienta o que revisar primeiro. */
  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true })
  confidence: string | null;

  @Column({ default: 'ia' })
  origin: LiveProductOrigin;

  /** Segundo da gravação em que o produto foi mencionado — leva à prova. */
  @Column({ type: 'int', nullable: true })
  sourceStartSec: number | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
