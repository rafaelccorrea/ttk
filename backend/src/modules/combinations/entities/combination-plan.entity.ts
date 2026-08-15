import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Plano de combinações Gancho × Corpo × CTA — sempre pertence a um usuário.
@Entity('combination_plans')
export class CombinationPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ length: 10 })
  sigla: string;

  @Column()
  format: '9:16' | '16:9' | '1:1';

  @Column('simple-json')
  hooks: string[];

  @Column('simple-json')
  bodies: string[];

  @Column('simple-json')
  ctas: string[];

  @CreateDateColumn()
  createdAt: Date;
}
