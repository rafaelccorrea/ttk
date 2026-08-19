import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CampaignScene } from './campaign-scene.entity';
import { Persona } from './persona.entity';
import { UserProduct } from './user-product.entity';

/**
 * Status na ordem em que acontecem — cada um exige a aprovação do anterior.
 * O vendedor só gasta crédito de vídeo depois de ler o roteiro e ver o rosto
 * do apresentador, nunca antes.
 */
export type CampaignStatus =
  | 'rascunho'
  | 'roteiro'
  | 'storyboard'
  | 'renderizando'
  | 'pronta';

/** A campanha amarra produto + persona + roteiro + cenas. É a unidade de venda. */
@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_campaigns_userId')
  @Column('uuid')
  userId: string;

  @Column('uuid')
  userProductId: string;

  @Column('uuid')
  personaId: string;

  /**
   * Relações declaradas só para o banco: nada no código carrega a campanha
   * com `relations`, mas as chaves estrangeiras existem desde a migração —
   * apagar um produto ou uma persona em uso deixaria a campanha órfã. Sem
   * declará-las aqui, o TypeORM não sabe que elas existem e a checagem de
   * drift do CI pede para removê-las a cada build.
   */
  @ManyToOne(() => UserProduct, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'userProductId',
    foreignKeyConstraintName: 'FK_campaigns_product',
  })
  userProduct?: UserProduct;

  @ManyToOne(() => Persona, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'personaId',
    foreignKeyConstraintName: 'FK_campaigns_persona',
  })
  persona?: Persona;

  @Column()
  title: string;

  /** 15s (3 cenas) é o padrão; 30s (6 cenas) dobra o custo. */
  @Column({ type: 'int', default: 15 })
  durationSeconds: number;

  @Column({ default: 'rascunho' })
  status: CampaignStatus;

  /** Roteiro aprovado, em Markdown — o mesmo formato do Estúdio. */
  @Column({ type: 'text', nullable: true })
  script: string | null;

  /**
   * Gesto de uso real do produto ("escreve no papel", "passa nos lábios"),
   * deduzido UMA vez pelo roteirista — que conhece nome, benefício e categoria
   * — e injetado verbatim no prompt de toda cena de demonstração. Sem ele o
   * modelo de vídeo tinha que adivinhar como o objeto se usa, e adivinhava
   * "segura e gira" para tudo.
   */
  @Column({ type: 'text', nullable: true })
  comoUsa: string | null;

  @Column({ nullable: true })
  model: string;

  /** Vídeo final montado a partir das cenas, no S3. */
  @Column({ type: 'text', nullable: true })
  finalVideoUrl: string | null;

  /**
   * Queimar as falas como legenda no vídeo final.
   *
   * Ligado por padrão (a maioria assiste sem som), mas é escolha: quem usa a
   * legenda automática do TikTok acabava com duas sobrepostas.
   */
  @Column({ type: 'boolean', default: true })
  subtitles: boolean;

  /**
   * Fila de renderização ligada: o polling dispara UMA cena por vez até
   * acabarem as pendentes. Fica no banco, e não em memória, porque a fila
   * atravessa muitos requests (cada avanço é um refresh) e precisa sobreviver
   * a um restart do servidor no meio da campanha.
   */
  @Column({ type: 'boolean', default: false })
  renderQueue: boolean;

  /**
   * Quanto já foi debitado. Somado cena a cena no momento de submeter cada
   * uma: cobrar tudo na frente quebra quando o vendedor desiste no meio.
   */
  @Column({ type: 'int', default: 0 })
  creditsSpent: number;

  @OneToMany(() => CampaignScene, (scene) => scene.campaign)
  scenes: CampaignScene[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
