import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { GeneratedMedia } from './entities/generated-media.entity';
import { HiggsfieldService } from './higgsfield.service';
import { VideogenController } from './videogen.controller';
import { VideogenService } from './videogen.service';
import { SingleFlightInterceptor } from '../../common/interceptors/single-flight.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([GeneratedMedia]), UsersModule, BillingModule],
  controllers: [VideogenController],
  providers: [SingleFlightInterceptor, VideogenService, HiggsfieldService],
  // As campanhas geram por aqui, pelos mesmos serviços — nenhuma chamada à
  // Higgsfield fora deste caminho, para a cobrança e o estorno valerem sempre.
  exports: [VideogenService],
})
export class VideogenModule {}
