import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { UsersModule } from '../users/users.module';
import { AiService } from './ai.service';
import { PromptTemplate } from './entities/prompt-template.entity';
import { Script } from './entities/script.entity';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Script, PromptTemplate, Product]),
    UsersModule,
  ],
  controllers: [StudioController],
  providers: [StudioService, AiService],
})
export class StudioModule {}
