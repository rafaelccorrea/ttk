import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { AiJob } from './entities/ai-job.entity';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

/**
 * Global: qualquer módulo que gere com IA precisa do executor, e fazer cada um
 * importar este módulo só espalharia a mesma linha por todo lado.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AiJob]), BillingModule, UsersModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
