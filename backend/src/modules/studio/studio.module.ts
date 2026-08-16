import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { Product } from '../products/entities/product.entity';
import { UserProduct } from '../campaigns/entities/user-product.entity';
import { VideoAssemblyService } from '../campaigns/video-assembly.service';
import { UsersModule } from '../users/users.module';
import { MediaModule } from '../media/media.module';
import { Video } from '../videos/entities/video.entity';
import { AiService } from './ai.service';
import { PromptRefreshService } from './prompt-refresh.service';
import { PromptTemplate } from './entities/prompt-template.entity';
import { Script } from './entities/script.entity';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';
import { TranscriptionService } from './transcription.service';
import { SingleFlightInterceptor } from '../../common/interceptors/single-flight.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Script, PromptTemplate, Product, UserProduct, Video]),
    UsersModule,
    BillingModule,
    MediaModule,
  ],
  controllers: [StudioController],
  providers: [
    SingleFlightInterceptor,
    StudioService,
    AiService,
    TranscriptionService,
    PromptRefreshService,
    // Não tem estado nem dependência: é um invólucro do ffmpeg, e o controller
    // usa só a leitura de duração para precificar a transcrição. Provider local
    // (como no Multiplicador) evita importar o módulo de campanhas inteiro.
    VideoAssemblyService,
  ],
  // As campanhas reaproveitam o mesmo gerador — não existe um segundo caminho
  // até o Claude, com outro prompt e outras regras.
  exports: [AiService],
})
export class StudioModule {}
