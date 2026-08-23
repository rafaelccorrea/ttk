import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailService } from '../auth/mail.service';
import { MediaModule } from '../media/media.module';
import { AppUser } from './entities/app-user.entity';
import { NovaContaService } from './nova-conta.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([AppUser]), MediaModule],
  controllers: [UsersController],
  // MailService entra aqui (e não via AuthModule) porque AuthModule importa
  // este módulo — importar de volta fecharia um ciclo. Ele só depende do
  // ConfigService, então uma segunda instância é inofensiva.
  providers: [UsersService, NovaContaService, MailService],
  exports: [UsersService, NovaContaService],
})
export class UsersModule {}
