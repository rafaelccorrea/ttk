import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { MediaModule } from '../media/media.module';
import { VideoAssemblyService } from '../campaigns/video-assembly.service';
import { CombinationsController } from './combinations.controller';
import { CombinationsService } from './combinations.service';
import { CombinationClip } from './entities/combination-clip.entity';
import { CombinationPlan } from './entities/combination-plan.entity';
import { CombinationVideo } from './entities/combination-video.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CombinationPlan, CombinationClip, CombinationVideo]),
    UsersModule,
    MediaModule,
  ],
  controllers: [CombinationsController],
  // A montagem é a mesma das campanhas — um só caminho até o ffmpeg.
  providers: [CombinationsService, VideoAssemblyService],
})
export class CombinationsModule {}
