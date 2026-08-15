import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trend } from '../trends/entities/trend.entity';
import { UsersModule } from '../users/users.module';
import { CreativeCenterSource } from './creative-center.source';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [TypeOrmModule.forFeature([Trend]), UsersModule],
  controllers: [IngestionController],
  providers: [IngestionService, CreativeCenterSource],
})
export class IngestionModule {}
