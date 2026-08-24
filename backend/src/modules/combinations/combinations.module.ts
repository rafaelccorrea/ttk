import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FfmpegRunner } from '../../common/media/ffmpeg-runner';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { MediaModule } from '../media/media.module';
import { VideoAssemblyService } from '../campaigns/video-assembly.service';
import { CombinationsController } from './combinations.controller';
import { CombinationsService } from './combinations.service';
import { CombinationClip } from './entities/combination-clip.entity';
import { CombinationFolder } from './entities/combination-folder.entity';
import { CombinationPlan } from './entities/combination-plan.entity';
import { CombinationVideo } from './entities/combination-video.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CombinationPlan,
      CombinationClip,
      CombinationVideo,
      CombinationFolder,
    ]),
    UsersModule,
    MediaModule,
    // Traz o PlanFeatureGuard: o multiplicador é recurso de plano pago.
    BillingModule,
  ],
  controllers: [CombinationsController],
  // A montagem é a mesma das campanhas — um só caminho até o ffmpeg.
  providers: [CombinationsService, VideoAssemblyService, FfmpegRunner],
  // Cortes manda um corte pronto para virar clipe do Multiplicador.
  exports: [CombinationsService],
})
export class CombinationsModule {}
