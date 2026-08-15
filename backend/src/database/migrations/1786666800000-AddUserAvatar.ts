import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foto de perfil do usuário.
 *
 * Até aqui o avatar era só as iniciais do nome — o que serve para identificar
 * a conta, mas não para a pessoa reconhecer que a conta é dela.
 */
export class AddUserAvatar1786666800000 implements MigrationInterface {
  name = 'AddUserAvatar1786666800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "avatarUrl" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "avatarUrl"`,
    );
  }
}
