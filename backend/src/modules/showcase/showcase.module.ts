import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ShowcaseController } from './showcase.controller';
import { ShowcaseService } from './showcase.service';

@Module({
  imports: [ProductsModule],
  controllers: [ShowcaseController],
  providers: [ShowcaseService],
})
export class ShowcaseModule {}
