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

  /**
   * Pasta escolhida pelo vendedor, ou `null` para "sem pasta".
   *
   * Sem FK de propósito: apagar uma pasta não pode apagar vídeo nenhum. O
   * serviço zera esta coluna e os vídeos voltam para "sem pasta".
   */
  @Index('IDX_combination_videos_folder')
  @Column({ type: 'uuid', nullable: true })
  folderId: string | null;

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

  /*
   * Desempenho do post — TUDO opcional.
   *
   * O vendedor lança se quiser; nada no Multiplicador depende disso. `null` não
   * é "zero", é "não informado", e a diferença importa: um vídeo com 0 views
   * lançado puxa a média do gancho para baixo, um vídeo não lançado não pode
   * puxar nada. Por isso são anuláveis em vez de `default 0`.
   *
   * Vale a pena existir porque o nome do arquivo carrega a composição
   * (G2C1A3), então resultado por vídeo vira resultado POR PEÇA: como cada
   * gancho aparece em `corpos × ctas` combinações, o efeito dele já sai
   * isolado sem o vendedor montar experimento nenhum.
   */
  @Column({ type: 'int', nullable: true })
  views: number | null;

  @Column({ type: 'int', nullable: true })
  sales: number | null;

  /** Link do post, só para o vendedor reencontrar o vídeo publicado. */
  @Column({ type: 'text', nullable: true })
  postUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
