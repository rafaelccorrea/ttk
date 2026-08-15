import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Video } from './video.entity';

// Vídeo salvo é sempre por usuário — nada global.
@Entity('saved_videos')
@Unique(['userId', 'videoId'])
export class SavedVideo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  videoId: string;

  @ManyToOne(() => Video, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'videoId' })
  video: Video;

  @CreateDateColumn()
  createdAt: Date;
}
