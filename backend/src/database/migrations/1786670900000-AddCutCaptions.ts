import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cortes, F3: legenda queimada. `cut_jobs.captions` é o que o usuário pediu;
 * `cut_clips.captions` é o que saiu de fato — o libass pode faltar no servidor
 * e aí o corte sai sem legenda em vez de não sair.
 */
export class AddCutCaptions1786670900000 implements MigrationInterface {
  name = 'AddCutCaptions1786670900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cut_jobs" ADD COLUMN IF NOT EXISTS "captions" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "cut_clips" ADD COLUMN IF NOT EXISTS "captions" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cut_clips" DROP COLUMN IF EXISTS "captions"`);
    await queryRunner.query(`ALTER TABLE "cut_jobs" DROP COLUMN IF EXISTS "captions"`);
  }
}
