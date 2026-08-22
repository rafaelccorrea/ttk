import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login com Google.
 *
 * Guardamos o `sub` do id_token do Google — o identificador estável da conta
 * Google — e não só o e-mail, porque e-mail de conta Google pode mudar e o
 * vínculo precisa sobreviver a isso. Único: um Google entra em uma conta.
 */
export class AddGoogleLogin1786669800000 implements MigrationInterface {
  name = 'AddGoogleLogin1786669800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "googleId" text`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_app_users_googleId" ON "app_users" ("googleId") WHERE "googleId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_users_googleId"`);
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "googleId"`,
    );
  }
}
