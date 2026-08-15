import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([AppUser]), UsersModule],
  controllers: [AuthController],
  providers: [AuthService, MailService, SupabaseAuthGuard],
  exports: [SupabaseAuthGuard, UsersModule],
})
export class AuthModule {}
