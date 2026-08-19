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
import { Campaign } from './campaign.entity';

export type SceneStatus = 'pendente' | 'renderizando' | 'pronta' | 'falhou';

/**
 * De qual imagem a cena é animada — é o que decide o que aparece na tela.
 *
 *  - `apresentador`: parte do retrato-semente da persona (mesmo rosto sempre);
 *  - `produto`: parte de uma FOTO REAL do produto do vendedor.
 *
 * O segundo tipo existe porque a IA não sabe como é o produto dele. Uma cena
 * de demonstração gerada só por texto inventa um objeto parecido, e o cliente
 * recebe um anúncio de um produto que não é o que ele vende. Animar a foto
 * verdadeira resolve isso e, de quebra, é a cena mais barata de acertar.
 */
export type SceneKind = 'apresentador' | 'produto';

/** Uma cena = uma geração de vídeo de ~5s. */
@Entity('campaign_scenes')
// Duas cenas na mesma posição do roteiro deixariam a ordem do vídeo ambígua.
@Index('UQ_campaign_scenes_ordem', ['campaignId', 'ordem'], { unique: true })
export class CampaignScene {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_campaign_scenes_campaignId')
  @Column('uuid')
  campaignId: string;

  @ManyToOne(() => Campaign, (campaign) => campaign.scenes, {
    onDelete: 'CASCADE',
  })
  // Nome explícito: é o mesmo que a migração cria. Sem ele o TypeORM espera o
  // nome em hash, e a checagem de drift do CI acusa diferença a cada build.
  @JoinColumn({
    name: 'campaignId',
    foreignKeyConstraintName: 'FK_campaign_scenes_campaign',
  })
  campaign: Campaign;

  @Column({ type: 'int' })
  ordem: number;

  @Column({ default: 'apresentador' })
  tipo: SceneKind;

  /**
   * Foto do produto usada como frame base, quando `tipo = 'produto'`.
   * Guardada na cena (e não lida do produto na hora) para o vídeo continuar
   * explicável mesmo se o vendedor trocar as fotos depois.
   */
  @Column({ type: 'text', nullable: true })
  baseImageUrl: string | null;

  /** O que a persona fala nesta cena — o vendedor edita livremente. */
  @Column({ type: 'text' })
  fala: string;

  /**
   * O que acontece na tela, em português. Este é o único campo de texto livre
   * do fluxo, e ele descreve AÇÃO — a aparência de quem aparece vem sempre do
   * `promptFragment` da persona.
   */
  @Column({ type: 'text' })
  acaoVisual: string;

  /**
   * Cena de apresentador em que a pessoa manuseia/usa o produto — dispara a
   * composição retrato+foto do produto na renderização. Marcado pelo roteiro;
   * a regex sobre `acaoVisual` ("segura", "na mão"...) vira só fallback, porque
   * não pegava ações de uso real ("passa o batom", "veste a camiseta").
   */
  @Column({ type: 'boolean', default: false })
  seguraProduto: boolean;

  /** Fragmento da persona + ação, montado no servidor na hora de renderizar. */
  @Column({ type: 'text', nullable: true })
  promptFinal: string | null;

  @Column({ default: 'pendente' })
  status: SceneStatus;

  /** Geração correspondente em `generated_media`. */
  @Column({ type: 'uuid', nullable: true })
  generatedMediaId: string | null;

  @Column({ type: 'text', nullable: true })
  outputUrl: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
