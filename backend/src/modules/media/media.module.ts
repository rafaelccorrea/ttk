import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaMirrorService } from './media-mirror.service';

@Module({
  controllers: [MediaController],
  providers: [MediaMirrorService],
  exports: [MediaMirrorService],
})
export class MediaModule {}
