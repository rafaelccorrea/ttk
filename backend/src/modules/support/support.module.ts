import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AppUser } from '../users/entities/app-user.entity';
import { UsersModule } from '../users/users.module';
import { SupportMessage } from './entities/support-message.entity';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  // UsersModule é necessário para o SupabaseAuthGuard usado no controller;
  // AuthModule fornece o MailService que avisa os admins.
  imports: [TypeOrmModule.forFeature([SupportMessage, AppUser]), UsersModule, AuthModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
