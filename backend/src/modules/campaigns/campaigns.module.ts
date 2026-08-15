import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SingleFlightInterceptor } from '../../common/interceptors/single-flight.interceptor';
import { BillingModule } from '../billing/billing.module';
import { MediaModule } from '../media/media.module';
import { Product } from '../products/entities/product.entity';
import { StudioModule } from '../studio/studio.module';
import { UsersModule } from '../users/users.module';
import { Video } from '../videos/entities/video.entity';
import { VideogenModule } from '../videogen/videogen.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { Campaign } from './entities/campaign.entity';
import { CampaignScene } from './entities/campaign-scene.entity';
import { Persona } from './entities/persona.entity';
import { UserProduct } from './entities/user-product.entity';
import { VideoAssemblyService } from './video-assembly.service';

/**
 * Fábrica de criativos: o vendedor traz o produto, escolhe quem apresenta,
 * aprova o roteiro e recebe o vídeo.
 *
 * Nenhum serviço próprio de IA aqui — a geração de texto passa pelo `AiService`
 * do Estúdio e a de mídia pelo `VideogenService`, que são os mesmos que os
 * endpoints existentes usam. É o que garante que a cobrança, o estorno e o
 * plano mínimo valham igual por qualquer caminho.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserProduct, Persona, Campaign, CampaignScene, Product, Video]),
    UsersModule,
    BillingModule,
    MediaModule,
    StudioModule,
    VideogenModule,
  ],
  controllers: [CampaignsController],
  providers: [SingleFlightInterceptor, CampaignsService, VideoAssemblyService],
})
export class CampaignsModule {}
