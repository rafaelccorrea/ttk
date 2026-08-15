import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lista de espera do soft launch.
 *
 * - `waitlistedAt`: entrada na fila. A ordem de liberação é esta coluna,
 *   não o createdAt — assim contas antigas (pré-waitlist) não furam a fila.
 * - `waitlistReleasedAt`: quando o link de confirmação foi enviado.
 *
 * Contas que já existiam continuam com as duas colunas nulas e seguem o
 * fluxo normal de confirmação.
 */
export class AddWaitlist1786666200000 implements MigrationInterface {
  name = 'AddWaitlist1786666200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "waitlistedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "waitlistReleasedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_users_waitlistedAt" ON "app_users" ("waitlistedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_users_waitlistedAt"`);
    for (const col of ['waitlistReleasedAt', 'waitlistedAt']) {
      await queryRunner.query(
        `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "${col}"`,
      );
    }
  }
}
