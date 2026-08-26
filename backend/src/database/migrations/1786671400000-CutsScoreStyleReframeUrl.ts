import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cortes, rodada "ser melhor" (docs/ROADMAP-CORTES-SER-MELHOR.md):
 *
 * - `cut_clips.score`: nota 0–10 que a IA dá ao trecho — a grade ordena por
 *   ela e mostra "por que esse". Nulo no modo rápido.
 * - `cut_jobs.captionStyle`: perfil da legenda queimada (classico, karaoke,
 *   impacto, minimal, oferta).
 * - `cut_jobs.reframe`: como enquadrar fonte horizontal em 9:16/1:1 —
 *   `rosto` segue quem fala, `blur` é o vídeo inteiro sobre fundo desfocado.
 * - `cut_jobs.sourceUrl`: quando a fonte veio por link (YouTube) e não upload.
 */
export class CutsScoreStyleReframeUrl1786671400000 implements MigrationInterface {
  name = 'CutsScoreStyleReframeUrl1786671400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cut_clips" ADD COLUMN IF NOT EXISTS "score" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "cut_jobs" ADD COLUMN IF NOT EXISTS "captionStyle" character varying(20) NOT NULL DEFAULT 'classico'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cut_jobs" ADD COLUMN IF NOT EXISTS "reframe" character varying(20) NOT NULL DEFAULT 'rosto'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cut_jobs" ADD COLUMN IF NOT EXISTS "sourceUrl" text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cut_jobs" DROP COLUMN IF EXISTS "sourceUrl"`);
    await queryRunner.query(`ALTER TABLE "cut_jobs" DROP COLUMN IF EXISTS "reframe"`);
    await queryRunner.query(`ALTER TABLE "cut_jobs" DROP COLUMN IF EXISTS "captionStyle"`);
    await queryRunner.query(`ALTER TABLE "cut_clips" DROP COLUMN IF EXISTS "score"`);
  }
}
