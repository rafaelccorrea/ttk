import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trabalhos de IA em background com progresso global (transcrição, análise,
 * roteiros, montagem). Ver `modules/jobs/entities/ai-job.entity.ts`.
 */
export class CreateAiJobs1786671100000 implements MigrationInterface {
  name = 'CreateAiJobs1786671100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "tipo" character varying(40) NOT NULL,
        "titulo" character varying(200) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'na_fila',
        "progresso" integer NOT NULL DEFAULT 0,
        "etapa" text,
        "referenciaId" uuid,
        "resultado" jsonb,
        "erro" text,
        "estornoAcao" character varying(40),
        "estornoQuantidade" integer,
        "heartbeatAt" timestamptz,
        "finishedAt" timestamptz,
        "dispensadoEm" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_jobs_user" ON "ai_jobs" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_jobs_status" ON "ai_jobs" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_jobs"`);
  }
}
