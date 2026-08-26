import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Custo por resposta (tokens) e hash da base que a gerou.
 *
 * Os tokens são a parte da resposta na chamada do lote — nulos quando não
 * houve modelo. O hash é a chave do reaproveitamento entre lives: a mesma
 * pergunta com a mesma base tem a mesma resposta, sem nova chamada.
 */
export class AddLiveReplyCostAndBaseHash1786671300000 implements MigrationInterface {
  name = 'AddLiveReplyCostAndBaseHash1786671300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_replies" ADD COLUMN IF NOT EXISTS "promptTokens" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "live_replies" ADD COLUMN IF NOT EXISTS "cachedTokens" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "live_replies" ADD COLUMN IF NOT EXISTS "completionTokens" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "live_replies" ADD COLUMN IF NOT EXISTS "baseHash" character varying(64) NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_replies_user_base" ON "live_replies" ("userId", "baseHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_live_replies_user_base"`);
    await queryRunner.query(`ALTER TABLE "live_replies" DROP COLUMN IF EXISTS "baseHash"`);
    await queryRunner.query(`ALTER TABLE "live_replies" DROP COLUMN IF EXISTS "completionTokens"`);
    await queryRunner.query(`ALTER TABLE "live_replies" DROP COLUMN IF EXISTS "cachedTokens"`);
    await queryRunner.query(`ALTER TABLE "live_replies" DROP COLUMN IF EXISTS "promptTokens"`);
  }
}
