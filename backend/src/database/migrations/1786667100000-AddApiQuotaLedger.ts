import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Livro-caixa da cota do fornecedor.
 *
 * Até aqui só a ingestão contava o que gastava. As chamadas do player
 * (resolver o MP4 na hora de tocar) não entravam em conta nenhuma e não tinham
 * teto: o medidor mostrava zero enquanto a cota real drenava por uso — foi
 * assim que as chaves anteriores acabaram sem ninguém ver.
 *
 * `apiPlaybackUsed` passa a contar esse gasto, e `apiPlaybackSharePct` reserva
 * uma fatia do teto para ele, para que uma finalidade nunca mate a outra.
 */
export class AddApiQuotaLedger1786667100000 implements MigrationInterface {
  name = 'AddApiQuotaLedger1786667100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "apiPlaybackUsed" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "apiPlaybackSharePct" integer NOT NULL DEFAULT 30`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "videoGapPerRun" integer NOT NULL DEFAULT 15`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" DROP COLUMN IF EXISTS "videoGapPerRun"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" DROP COLUMN IF EXISTS "apiPlaybackSharePct"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" DROP COLUMN IF EXISTS "apiPlaybackUsed"`,
    );
  }
}
