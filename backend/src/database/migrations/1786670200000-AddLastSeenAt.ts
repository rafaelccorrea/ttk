import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Último acesso da conta, para o painel administrativo.
 *
 * `app_users.lastSeenAt` é gravado pelo guard de autenticação com folga de
 * minutos (não a cada request). Responde "quem ainda usa o app" e "quem
 * cadastrou e nunca voltou" — perguntas que `createdAt` e o extrato de
 * créditos não respondem: quem só navega não gasta crédito.
 */
export class AddLastSeenAt1786670200000 implements MigrationInterface {
  name = 'AddLastSeenAt1786670200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "lastSeenAt" timestamptz`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_users_lastSeenAt" ON "app_users" ("lastSeenAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_users_lastSeenAt"`);
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "lastSeenAt"`,
    );
  }
}
