import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FfmpegRunner } from '../../common/media/ffmpeg-runner';
import { BillingModule } from '../billing/billing.module';
import { CombinationsModule } from '../combinations/combinations.module';
import { AudioChunkerService } from '../live/audio-chunker.service';
import { MediaModule } from '../media/media.module';
import { StudioModule } from '../studio/studio.module';
import { TranscriptionService } from '../studio/transcription.service';
import { UsersModule } from '../users/users.module';
import { CutsController } from './cuts.controller';
import { CutsService } from './cuts.service';
import { CutClip } from './entities/cut-clip.entity';
import { CutJob } from './entities/cut-job.entity';
import { FaceTrackerService } from './face-tracker.service';
import { VideoDownloaderService } from './video-downloader.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CutJob, CutClip]),
    UsersModule,
    MediaModule,
    // PlanFeatureGuard + cobrança por corte.
    BillingModule,
    // AiService (escolha dos trechos no modo inteligente). A AiCostService que
    // a TranscriptionService exige vem do TelemetryModule, que é @Global.
    StudioModule,
    // Um corte pronto vira clipe do Multiplicador (`enviarParaMultiplicador`).
    CombinationsModule,
  ],
  controllers: [CutsController],
  // Chunker e transcrição não têm estado: instância própria, como no LiveModule.
  providers: [
    CutsService,
    FfmpegRunner,
    AudioChunkerService,
    TranscriptionService,
    // Rosto (BlazeFace) e download por link (yt-dlp): os dois degradam
    // sozinhos — sem modelo/binário o corte sai como antes, nunca falha.
    FaceTrackerService,
    VideoDownloaderService,
  ],
})
export class CutsModule {}
