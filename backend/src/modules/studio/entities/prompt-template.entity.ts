import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 'seed' = base curada, escrita à mão. Nunca é apagada por rotina automática:
 *          é o piso de qualidade do Cofre e a garantia de que uma safra ruim
 *          da IA não deixa a tela vazia.
 * 'auto' = destilado do que está performando agora no catálogo.
 */
export type PromptSource = 'seed' | 'auto';

// Cofre de prompts: prompts prontos de vídeo/imagem IA com campos a preencher.
@Entity('prompt_templates')
export class PromptTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  mediaType: 'video' | 'image';

  @Column({ type: 'int', nullable: true })
  durationSec: number;

  @Column('simple-array')
  niches: string[];

  @Column('simple-array')
  tags: string[];

  // Texto do prompt com placeholders {{campo}}.
  @Column({ type: 'text' })
  template: string;

  // Campos que o usuário preenche (nomes dos placeholders).
  @Column('simple-array')
  fields: string[];

  @Column({ nullable: true })
  previewUrl: string;

  @Index()
  @Column({ type: 'varchar', default: 'seed' })
  source: PromptSource;

  /**
   * Chave estável de deduplicação (hash do título normalizado).
   *
   * Sem ela, cada rodada semanal reinseriria variações do mesmo prompt e em
   * três meses o Cofre viraria uma lista de duplicatas quase idênticas. Com
   * ela, rodar de novo ATUALIZA o prompt existente em vez de empilhar.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  sourceKey: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
