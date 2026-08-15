import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { GeneratedMedia } from './entities/generated-media.entity';
import { HiggsfieldService } from './higgsfield.service';
import { VideogenController } from './videogen.controller';
import { VideogenService } from './videogen.service';

@Module({
  imports: [TypeOrmModule.forFeature([GeneratedMedia]), UsersModule],
  controllers: [VideogenController],
  providers: [VideogenService, HiggsfieldService],
})
export class VideogenModule {}
