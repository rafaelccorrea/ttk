import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vídeos no Multiplicador.
 *
 * Até aqui o módulo só produzia uma planilha de nomes de arquivo: o vendedor
 * enviava texto e montava tudo à mão depois. Estas tabelas guardam os clipes
 * enviados e os vídeos já concatenados pelo servidor.
 */
export class AddCombinationClips1786666600000 implements MigrationInterface {
  name = 'AddCombinationClips1786666600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "combination_clips" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "role" character varying(10) NOT NULL,
        "label" character varying NOT NULL,
        "url" text NOT NULL,
        "sizeBytes" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_combination_clips" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_combination_clips_user" ON "combination_clips" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "combination_videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "planId" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "filename" character varying NOT NULL,
        "url" text,
        "status" character varying(20) NOT NULL DEFAULT 'pendente',
        "error" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_combination_videos" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_combination_videos_user" ON "combination_videos" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_combination_videos_plan" ON "combination_videos" ("planId")`,
    );

    for (const coluna of ['hookClipIds', 'bodyClipIds', 'ctaClipIds']) {
      await queryRunner.query(
        `ALTER TABLE "combination_plans" ADD COLUMN IF NOT EXISTS "${coluna}" text NOT NULL DEFAULT '[]'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const coluna of ['hookClipIds', 'bodyClipIds', 'ctaClipIds']) {
      await queryRunner.query(
        `ALTER TABLE "combination_plans" DROP COLUMN IF EXISTS "${coluna}"`,
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "combination_videos"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "combination_clips"`);
  }
}
