import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { CreatorsController } from './creators.controller';
import { CreatorsService } from './creators.service';
import { Creator } from './entities/creator.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Creator]), UsersModule],
  controllers: [CreatorsController],
  providers: [CreatorsService],
  exports: [CreatorsService],
})
export class CreatorsModule {}
