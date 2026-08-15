import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CampaignScene } from './campaign-scene.entity';

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

  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  userProductId: string;

  @Column('uuid')
  personaId: string;

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

  @Column({ nullable: true })
  model: string;

  /** Vídeo final montado a partir das cenas, no S3. */
  @Column({ type: 'text', nullable: true })
  finalVideoUrl: string | null;

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
