import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FfmpegRunner } from '../../common/media/ffmpeg-runner';
import { BillingModule } from '../billing/billing.module';
import { StudioModule } from '../studio/studio.module';
import { TranscriptionService } from '../studio/transcription.service';
import { AppUser } from '../users/entities/app-user.entity';
import { UsersModule } from '../users/users.module';
import { AudioChunkerService } from './audio-chunker.service';
import { LiveChatMessage } from './entities/live-chat-message.entity';
import { LiveFaq } from './entities/live-faq.entity';
import { LiveProduct } from './entities/live-product.entity';
import { LiveReply } from './entities/live-reply.entity';
import { LiveRun } from './entities/live-run.entity';
import { LiveRunEvent } from './entities/live-run-event.entity';
import { LiveRunMetric } from './entities/live-run-metric.entity';
import { LiveSession } from './entities/live-session.entity';
import { LiveSelectorFailure } from './entities/live-selector-failure.entity';
import { LiveController } from './live.controller';
import { LiveConfigController } from './live-config.controller';
import { DownloadController } from './download.controller';
import { LiveConfigService } from './live-config.service';
import { LiveEventsService } from './live-events.service';
import { LiveReplyService } from './live-reply.service';
import { LiveRunController } from './live-run.controller';
import { LiveService } from './live.service';

/**
 * Live Copilot: a gravação vira base de conhecimento editável (fase 0) e a base
 * atende o chat da transmissão em tempo real, em modo somente-painel (fase 1).
 *
 * Os dois controllers dividem o prefixo `live` de propósito — é uma feature só
 * para quem compra e para quem lê o Swagger. O que os separa é o ciclo de vida:
 * um é CRUD de catálogo, o outro é uma conexão que fica aberta a live inteira,
 * cobra por minuto e mantém estado em memória (ver a nota de escopo do SSE no
 * topo do `LiveRunController`).
 *
 * O `AiService` vem do Estúdio, que o exporta — é o mesmo caminho até o Claude
 * que o roteirizador e as campanhas usam, com a mesma cobrança e o mesmo plano
 * mínimo por trás. O `TranscriptionService`, que o Estúdio não exporta, é
 * declarado aqui como provider próprio: ele não guarda estado (é um invólucro
 * do Whisper sobre o ConfigService), então uma segunda instância é idêntica à
 * primeira. É o mesmo arranjo que o Estúdio faz com o `VideoAssemblyService`
 * das campanhas — a alternativa seria alargar a superfície exportada de um
 * módulo por conveniência de outro.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      LiveSession,
      LiveProduct,
      LiveFaq,
      LiveRun,
      LiveRunEvent,
      LiveRunMetric,
      LiveChatMessage,
      LiveReply,
      // A telemetria de seletor quebrado — o sinal de que o TikTok mudou o HTML
      // e de que precisamos publicar cascata nova (ver `LiveConfigService`).
      LiveSelectorFailure,
      // O aceite do termo de risco do envio automático mora em `app_users`, e o
      // motor precisa lê-lo antes de deixar uma run entrar em modo `auto`. O
      // `forFeature` do módulo de usuários não alcança este injetor.
      AppUser,
    ]),
    // O `SupabaseAuthGuard` do controller injeta o `UsersService` para resolver
    // o plano de quem chama — sem este import o Nest nem sobe.
    UsersModule,
    BillingModule,
    StudioModule,
  ],
  controllers: [
    LiveController,
    LiveRunController,
    LiveConfigController,
    // Publico e sem guard, ao contrario dos outros tres — o porque esta no
    // comentario de topo do proprio controller.
    DownloadController,
  ],
  providers: [
    LiveService,
    LiveReplyService,
    LiveConfigService,
    LiveEventsService,
    AudioChunkerService,
    TranscriptionService,
    FfmpegRunner,
  ],
  exports: [LiveReplyService, LiveConfigService],
})
export class LiveModule {}
