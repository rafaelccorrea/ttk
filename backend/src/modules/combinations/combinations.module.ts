import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { CombinationsController } from './combinations.controller';
import { CombinationsService } from './combinations.service';
import { CombinationPlan } from './entities/combination-plan.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CombinationPlan]), UsersModule],
  controllers: [CombinationsController],
  providers: [CombinationsService],
})
export class CombinationsModule {}
