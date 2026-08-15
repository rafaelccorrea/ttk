import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suporte à ingestão via EchoTik:
 *  - creators.externalId: chave de upsert estável (o `user_id` do fornecedor).
 *  - ingestion_settings.api*: controle de cota mensal persistido, para que
 *    restart/deploy não zere o contador e a cota não estoure no meio do mês.
 *  - cron padrão passa a 3x ao dia.
 */
export class AddEchoTikIngestion1786665700000 implements MigrationInterface {
  name = 'AddEchoTikIngestion1786665700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "externalId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "creators" ADD CONSTRAINT "UQ_creators_externalId" UNIQUE ("externalId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "apiMonthKey" character varying(7) NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "apiRequestsUsed" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "apiMonthlyBudget" integer NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ALTER COLUMN "cronExpr" SET DEFAULT '0 0 6,14,22 * * *'`,
    );
    // Só atualiza quem ainda está no padrão antigo — respeita ajuste manual.
    await queryRunner.query(
      `UPDATE "ingestion_settings" SET "cronExpr" = '0 0 6,14,22 * * *' WHERE "cronExpr" = '0 0 6 * * *'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ALTER COLUMN "cronExpr" SET DEFAULT '0 0 6 * * *'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" DROP COLUMN IF EXISTS "apiMonthlyBudget"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" DROP COLUMN IF EXISTS "apiRequestsUsed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" DROP COLUMN IF EXISTS "apiMonthKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creators" DROP CONSTRAINT IF EXISTS "UQ_creators_externalId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "creators" DROP COLUMN IF EXISTS "externalId"`,
    );
  }
}
