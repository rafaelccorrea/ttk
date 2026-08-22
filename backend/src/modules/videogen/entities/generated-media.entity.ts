import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type MediaKind = 'image' | 'video';
export type MediaStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'nsfw'
  | 'canceled';

// Geração de mídia por IA (Higgsfield) — sempre pertence a um usuário.
@Entity('generated_media')
export class GeneratedMedia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column()
  kind: MediaKind;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ default: '9:16' })
  aspectRatio: string;

  @Column({ default: 'queued' })
  status: MediaStatus;

  /**
   * Para vídeo, a geração tem 2 fases: 'image' (Soul cria o frame base)
   * e 'video' (DoP anima a imagem). Imagens têm só a fase 'image'.
   */
  @Column({ default: 'image' })
  phase: 'image' | 'video';

  // request_id da fase atual na Higgsfield.
  @Column({ nullable: true })
  requestId: string;

  // Imagem base gerada (fase 1 do vídeo, ou resultado final de imagem).
  @Column({ nullable: true })
  imageUrl: string;

  // Resultado final (imagem ou vídeo).
  @Column({ nullable: true })
  outputUrl: string;

  @Column({ nullable: true })
  error: string;

  // Créditos já estornados por falha (evita estorno duplo no refresh).
  @Column({ default: false })
  refunded: boolean;

  /**
   * Modelo de vídeo que gerou (ou vai gerar) este item — `kling3_0_turbo`,
   * `seedance_2_0`... É o que permite comparar IA por tipo de cena depois.
   */
  @Column({ type: 'text', nullable: true })
  model: string | null;

  /** Voz de referência (URL no S3) a enviar junto na animação — fase 2 inclusive. */
  @Column({ type: 'text', nullable: true })
  voiceRefUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
