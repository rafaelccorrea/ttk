import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MaxFileSizeValidator,
  ParseFilePipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  me(@CurrentUser() user: AuthUser) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Atualiza o perfil do usuário autenticado' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto.displayName);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Troca a foto de perfil' })
  avatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie uma imagem.');
    }
    // O `mimetype` do multipart é escolhido por quem envia; quem valida de
    // verdade é a decodificação da imagem, dentro do espelhamento.
    return this.usersService.updateAvatar(user.id, file.buffer);
  }
}
