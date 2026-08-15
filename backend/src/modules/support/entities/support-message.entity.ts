import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SupportSender = 'user' | 'agent';

// Mensagem do chat de suporte interno (uma conversa por usuário).
@Entity('support_messages')
export class SupportMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 10 })
  sender: SupportSender;

  @Column('text')
  text: string;

  @Column({ default: false })
  readByAgent: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
