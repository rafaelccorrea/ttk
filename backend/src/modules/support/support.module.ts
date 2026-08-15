import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { SupportMessage } from './entities/support-message.entity';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  // UsersModule é necessário para o SupabaseAuthGuard usado no controller.
  imports: [TypeOrmModule.forFeature([SupportMessage]), UsersModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
