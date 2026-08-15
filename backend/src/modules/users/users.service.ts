import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { AppUser } from './entities/app-user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(AppUser)
    private readonly repository: Repository<AppUser>,
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
}
