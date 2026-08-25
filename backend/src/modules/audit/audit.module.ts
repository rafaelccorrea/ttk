import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

/**
 * Auditoria ponta a ponta. `@Global` pelo mesmo motivo do TelemetryModule:
 * qualquer serviço pode registrar um evento de negócio sem importar nada, e
 * o interceptor global cobre todas as rotas que mudam estado automaticamente.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
