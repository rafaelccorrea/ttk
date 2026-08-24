import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cortes: um vídeo longo vira N vídeos curtos (docs/PLANO-CORTES.md).
 *
 * `cut_jobs` é o pedido (fonte, modo, parâmetros, cobrança pendente);
 * `cut_clips` são os cortes entregues. Os marcadores `pending*` do job são o
 * rastro da cobrança que o cron usa para estornar quando o processo morre
 * antes de entregar — mesmo desenho das `live_sessions`.
 */
export class CreateCuts1786670800000 implements MigrationInterface {
  name = 'CreateCuts1786670800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cut_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'pendente',
        "mode" character varying(20) NOT NULL,
        "format" character varying(10) NOT NULL DEFAULT '9:16',
        "quantity" integer NOT NULL,
        "minSeconds" integer NOT NULL,
        "maxSeconds" integer NOT NULL,
        "sourceName" character varying(255) NOT NULL,
        "sourceDurationSeconds" integer,
        "sourcePath" text,
        "error" text,
        "processingStartedAt" TIMESTAMP WITH TIME ZONE,
        "pendingCutCharges" integer NOT NULL DEFAULT 0,
        "pendingTranscribeBlocks" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cut_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cut_jobs_user" ON "cut_jobs" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cut_jobs_status" ON "cut_jobs" ("status")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cut_clips" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "jobId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "position" integer NOT NULL,
        "startSeconds" real NOT NULL,
        "endSeconds" real NOT NULL,
        "title" text,
        "hook" text,
        "reason" text,
        "origin" character varying(10) NOT NULL DEFAULT 'rapido',
        "url" text,
        "status" character varying(20) NOT NULL DEFAULT 'pendente',
        "error" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cut_clips" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cut_clips_job" FOREIGN KEY ("jobId")
          REFERENCES "cut_jobs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cut_clips_job" ON "cut_clips" ("jobId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cut_clips_user" ON "cut_clips" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cut_clips"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cut_jobs"`);
  }
}
