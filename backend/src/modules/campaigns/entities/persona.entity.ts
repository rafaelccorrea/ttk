import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PersonaAttributes } from '../persona-catalog';

export type PersonaStatus = 'gerando' | 'pronta' | 'falhou';

/**
 * Quem apresenta o produto no vídeo.
 *
 * O campo que faz o sistema funcionar é `seedImageUrl`: o retrato é gerado UMA
 * vez e reusado como imagem de entrada em todas as cenas. A API de vídeo não
 * tem identificador de personagem — duas chamadas com o mesmo texto devolvem
 * pessoas parecidas, não a mesma. O retrato-semente é o que mantém o rosto.
 *
 * Por isso ele é espelhado no S3 assim que fica pronto: a URL da fornecedora
 * expira, e uma persona que perde o retrato perde a consistência de todas as
 * campanhas futuras.
 */
@Entity('personas')
export class Persona {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  /** Nome dado pelo vendedor ("Ju da cozinha"), ou o rótulo automático. */
  @Column()
  label: string;

  /** Ids do catálogo, já validados. Nunca texto livre. */
  @Column({ type: 'jsonb' })
  attrs: PersonaAttributes;

  /** Derivado de `attrs` no servidor — nunca aceito do cliente. */
  @Column({ type: 'text' })
  promptFragment: string;

  @Column({ default: 'gerando' })
  status: PersonaStatus;

  /** Geração do retrato (tabela `generated_media`), enquanto não conclui. */
  @Column({ type: 'uuid', nullable: true })
  seedMediaId: string | null;

  /** Retrato-semente definitivo, no S3. */
  @Column({ type: 'text', nullable: true })
  seedImageUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
