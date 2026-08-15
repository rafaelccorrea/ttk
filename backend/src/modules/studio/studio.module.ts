import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { Product } from '../products/entities/product.entity';
import { UsersModule } from '../users/users.module';
import { AiService } from './ai.service';
import { PromptTemplate } from './entities/prompt-template.entity';
import { Script } from './entities/script.entity';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';
import { TranscriptionService } from './transcription.service';
import { SingleFlightInterceptor } from '../../common/interceptors/single-flight.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Script, PromptTemplate, Product]),
    UsersModule,
    BillingModule,
  ],
  controllers: [StudioController],
  providers: [SingleFlightInterceptor, StudioService, AiService, TranscriptionService],
})
export class StudioModule {}
