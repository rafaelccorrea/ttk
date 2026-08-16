import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type CombinationVideoStatus = 'pendente' | 'montando' | 'pronto' | 'falhou';

/**
 * Quão diferente este vídeo é dos que vêm antes dele na ordem de postagem.
 *
 * A matriz G×C×A produz vídeos que reaproveitam pedaços entre si — postar dois
 * seguidos que compartilham o gancho é o jeito mais rápido de o algoritmo tratar
 * o segundo como repost. A etiqueta diz o que postar primeiro.
 */
export type CombinationOriginality = 'original' | 'parecido' | 'muito-parecido';

/**
 * Um vídeo já concatenado (gancho + corpo + CTA) pronto para postar.
 *
 * Cada linha corresponde a uma célula da matriz do plano. A montagem é lenta
 * (ffmpeg, alguns segundos por vídeo, dezenas de vídeos por plano), então o
 * registro nasce `pendente` e a tela acompanha o status — em vez de segurar a
 * requisição até o último arquivo ficar pronto.
 */
@Entity('combination_videos')
export class CombinationVideo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_combination_videos_user')
  @Column('uuid')
  userId: string;

  @Index('IDX_combination_videos_plan')
  @Column('uuid')
  planId: string;

  /** Código da célula na matriz: G1C2A3. */
  @Column({ length: 20 })
  code: string;

  @Column()
  filename: string;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ length: 20, default: 'pendente' })
  status: CombinationVideoStatus;

  /** Motivo da falha, para a tela não mostrar só "falhou". */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Etiqueta de originalidade — ver {@link CombinationOriginality}. */
  @Column({ length: 20, default: 'original' })
  originality: CombinationOriginality;

  /**
   * Posição na ordem recomendada de postagem, começando em 1.
   *
   * Não é a ordem da matriz: `montarTudo` reordena para espalhar os ganchos
   * repetidos o mais longe possível uns dos outros.
   */
  @Column({ type: 'int', default: 0 })
  postOrder: number;

  @CreateDateColumn()
  createdAt: Date;
}
