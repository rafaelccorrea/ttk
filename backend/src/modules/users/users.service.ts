import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { MediaMirrorService } from '../media/media-mirror.service';
import { AppUser } from './entities/app-user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(AppUser)
    private readonly repository: Repository<AppUser>,
    private readonly mirror: MediaMirrorService,
  ) {}

  /**
   * Upsert leve chamado pelo guard a cada requisição autenticada.
   *
   * Cuidado histórico: o orIgnore só protege contra conflito de id. Um token
   * com outro `sub` mas o MESMO e-mail criava uma segunda conta sem senha, e
   * o login passava a encontrar a errada ("e-mail ou senha incorretos" numa
   * conta válida). Por isso conferimos o e-mail antes de inserir.
   */
  async ensure(user: AuthUser): Promise<void> {
    const existing = await this.repository.findOne({
      where: [{ id: user.id }, { email: user.email }],
    });
    if (existing) return;
    await this.repository
      .createQueryBuilder()
      .insert()
      .values({ id: user.id, email: user.email })
      .orIgnore()
      .execute();
  }

  async findById(id: string): Promise<AppUser> {
    const user = await this.repository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`Usuário ${id} não encontrado`);
    }
    return user;
  }

  async updateProfile(id: string, displayName: string): Promise<AppUser> {
    await this.repository.update({ id }, { displayName });
    return this.findById(id);
  }

  /**
   * Troca a foto de perfil.
   *
   * A imagem é normalizada e guardada no nosso bucket, como as demais: a URL
   * fica permanente e não depende de host de terceiro. A chave leva o hash do
   * conteúdo, então reenviar a mesma foto não cria objeto novo.
   */
  async updateAvatar(id: string, buffer: Buffer): Promise<AppUser> {
    const url = await this.mirror.putImage(buffer, 'avatars', id, 'cover');
    if (!url) {
      throw new BadRequestException(
        'A imagem não pôde ser guardada. Envie um PNG ou JPG.',
      );
    }
    await this.repository.update({ id }, { avatarUrl: url });
    return this.findById(id);
  }
}
