import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Sobre o que é esta live", escrito pelo vendedor. Vai inteiro para o prompt
 * do copiloto: sem ele, o modelo só conhece produtos e FAQ e não sabe quem
 * apresenta, para quem, nem o tom da transmissão. Nulo por padrão — a base
 * extraída de gravação continua funcionando sem contexto.
 */
export class AddLiveSessionContext1786671000000 implements MigrationInterface {
  name = 'AddLiveSessionContext1786671000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_sessions" ADD COLUMN IF NOT EXISTS "context" text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_sessions" DROP COLUMN IF EXISTS "context"`,
    );
  }
}
