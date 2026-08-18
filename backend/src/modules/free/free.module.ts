import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { AppUser } from '../users/entities/app-user.entity';
import { UsersModule } from '../users/users.module';
import { Video } from '../videos/entities/video.entity';
import { FreeSample } from './entities/free-sample.entity';
import { FreeController } from './free.controller';
import { FreePlanGuard } from './free-plan.guard';
import { FreeSampleService } from './free-sample.service';

/**
 * O modo amostra da conta gratuita (`docs/CONTA-FREE.md`).
 *
 * Depende das ENTIDADES de produto e vídeo, não dos serviços deles — de
 * propósito. Reusar `ProductsService` traria junto favoritos, filtros e o
 * formato completo do card, e a distância entre "chamei o serviço pago" e
 * "entreguei o dado pago" seria de um campo esquecido. O módulo lê o que
 * precisa e monta a sua própria resposta reduzida.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FreeSample, Product, Video, AppUser]),
    // O SupabaseAuthGuard do controller depende do UsersService.
    UsersModule,
  ],
  controllers: [FreeController],
  providers: [FreeSampleService, FreePlanGuard],
  exports: [FreeSampleService],
})
export class FreeModule {}
