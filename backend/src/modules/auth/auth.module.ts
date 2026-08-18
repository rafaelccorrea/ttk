import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DeviceFlowController } from './device-flow.controller';
import { DeviceFlowService } from './device-flow.service';
import { DeviceAuthorization } from './entities/device-authorization.entity';
import { MailService } from './mail.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([AppUser, DeviceAuthorization]),
    UsersModule,
  ],
  controllers: [AuthController, DeviceFlowController],
  providers: [AuthService, MailService, SupabaseAuthGuard, DeviceFlowService],
  exports: [SupabaseAuthGuard, MailService, UsersModule],
})
export class AuthModule {}
