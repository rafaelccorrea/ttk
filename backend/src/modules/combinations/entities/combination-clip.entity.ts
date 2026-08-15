import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Onde o clipe entra na fórmula: gancho, corpo ou CTA. */
export type ClipRole = 'hook' | 'body' | 'cta';

/**
 * Um clipe de vídeo enviado pelo vendedor.
 *
 * O plano de combinações nasceu só com texto — o nome do clipe — e a montagem
 * do arquivo sobrava para o vendedor no celular. Aqui o vídeo em si fica no
 * nosso bucket, e é ele que o ffmpeg concatena depois.
 *
 * O clipe vive fora do plano de propósito: ele é enviado antes de existir
 * plano, e o mesmo gancho costuma ser reaproveitado em vários produtos.
 */
@Entity('combination_clips')
export class CombinationClip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ length: 10 })
  role: ClipRole;

  /** Nome do arquivo original — é o que o vendedor reconhece na lista. */
  @Column()
  label: string;

  /** URL no nosso bucket (rota `/media/s3/...`). */
  @Column('text')
  url: string;

  @Column({ type: 'int', default: 0 })
  sizeBytes: number;

  @CreateDateColumn()
  createdAt: Date;
}
