import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

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

  @CreateDateColumn()
  createdAt: Date;
}
