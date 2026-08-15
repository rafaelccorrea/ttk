import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recuperação de senha ("esqueci minha senha").
 *
 * - `resetTokenHash`: SHA-256 do token que vai no link do e-mail. Guardar o
 *   hash (e não o token cru, como é feito em `confirmationToken`) impede que
 *   um vazamento do banco vire tomada de conta.
 * - `resetTokenExpiresAt`: o link vale por 1 hora.
 * - `resetSentAt`: base do cooldown de 60s entre pedidos.
 */
export class AddPasswordReset1786666000000 implements MigrationInterface {
  name = 'AddPasswordReset1786666000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "resetTokenHash" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "resetTokenExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "resetSentAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_users_resetTokenHash" ON "app_users" ("resetTokenHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_app_users_resetTokenHash"`,
    );
    for (const col of ['resetSentAt', 'resetTokenExpiresAt', 'resetTokenHash']) {
      await queryRunner.query(
        `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "${col}"`,
      );
    }
  }
}
