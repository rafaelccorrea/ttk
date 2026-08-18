import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Duração do clipe no Multiplicador.
 *
 * A fórmula 3s/10s/5s (gancho/corpo/CTA) só vira verificável se a duração for
 * medida. Os clipes já enviados ficam com `0` — "não medido" —, que a aplicação
 * trata como ausência de informação e nunca como motivo de bloqueio.
 */
export class AddClipDuration1786668700000 implements MigrationInterface {
  name = 'AddClipDuration1786668700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "combination_clips" ADD COLUMN IF NOT EXISTS "durationMs" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "combination_clips" DROP COLUMN IF EXISTS "durationMs"`,
    );
  }
}
