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
 * O formato da cena — decide de qual imagem ela é animada e o que aparece.
 *
 *  - `apresentador`: pessoa falando para a câmera; parte do retrato-semente
 *    da persona (mesmo rosto sempre);
 *  - `apresentador_produto`: apresentador segurando/usando o produto — o
 *    frame é COMPOSTO retrato+foto real (antes era `seguraProduto=true`);
 *  - `mao_produto`: só as mãos manuseando/aplicando o produto, sem rosto;
 *  - `unboxing`: mãos abrindo a caixa/embalagem, sem rosto;
 *  - `produto_close`: close do produto, sem pessoa (antes era `produto`).
 *
 * Os três últimos partem de uma FOTO REAL do produto do vendedor: uma cena
 * gerada só por texto inventa um objeto parecido, e o cliente recebe um
 * anúncio de um produto que não é o que ele vende. Animar a foto verdadeira
 * resolve isso e, de quebra, é a cena mais barata de acertar.
 */
export type SceneKind =
  | 'apresentador'
  | 'apresentador_produto'
  | 'mao_produto'
  | 'unboxing'
  | 'produto_close';

/** Cenas em que ninguém aparece em quadro — partem da foto do produto. */
const SEM_PESSOA: SceneKind[] = ['mao_produto', 'unboxing', 'produto_close'];

export function cenaSemPessoa(tipo: SceneKind): boolean {
  return SEM_PESSOA.includes(tipo);
}

export function cenaComApresentador(tipo: SceneKind): boolean {
  return !cenaSemPessoa(tipo);
}

/**
 * Como a fala da cena vira áudio.
 *
 *  - `fala`: o próprio modelo de vídeo gera a voz, sincronizada com os
 *    lábios — só faz sentido com apresentador em quadro;
 *  - `narracao`: voz em off por TTS, dublada após a renderização — o padrão
 *    das cenas sem pessoa;
 *  - `sem_fala`: só a ação visual; música/legenda cobrem o resto.
 */
export type SceneAudioMode = 'fala' | 'narracao' | 'sem_fala';

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
   * Como a fala vira áudio. Gravado pelo roteiro (`fala` para apresentador,
   * `narracao` para cena sem pessoa) e editável pelo vendedor no storyboard.
   */
  @Column({ default: 'fala' })
  modoAudio: SceneAudioMode;

  /**
   * Foto do produto usada como frame base, quando a cena é sem pessoa.
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
   * LEGADO: substituído por `tipo = 'apresentador_produto'`. Mantido porque
   * cenas antigas ainda dependem dele (e da regex sobre `acaoVisual`) como
   * fallback na renderização; some quando essas campanhas saírem do ar.
   */
  @Column({ type: 'boolean', default: false })
  seguraProduto: boolean;

  /** Fragmento da persona + ação, montado no servidor na hora de renderizar. */
  @Column({ type: 'text', nullable: true })
  promptFinal: string | null;

  /**
   * Modelo de vídeo FORÇADO nesta cena (experimento A/B). Nulo = o padrão do
   * perfil da cena (ver `modelos-de-video.ts`). O que de fato gerou fica em
   * `generated_media.model`.
   */
  @Column({ type: 'text', nullable: true })
  modelo: string | null;

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
