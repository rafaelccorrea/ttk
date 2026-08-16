import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { MediaModule } from '../media/media.module';
import { UsersModule } from '../users/users.module';
import { SavedVideo } from './entities/saved-video.entity';
import { Video } from './entities/video.entity';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, SavedVideo]),
    UsersModule,
    IngestionModule,
    MediaModule,
    // O PlanFeatureGuard do controller depende do BillingService.
    BillingModule,
  ],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
