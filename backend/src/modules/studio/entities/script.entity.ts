import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Roteiro gerado — sempre pertence a um usuário.
@Entity('scripts')
export class Script {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column()
  type: 'live' | 'video';

  @Column()
  productName: string;

  @Column({ type: 'text', nullable: true })
  productDescription: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ nullable: true })
  model: string;

  @CreateDateColumn()
  createdAt: Date;
}
