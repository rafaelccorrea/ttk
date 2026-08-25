import { MigrationInterface, QueryRunner } from 'typeorm';

/** Trilha de auditoria global. Ver `modules/audit/entities/audit-log.entity.ts`. */
export class CreateAuditLogs1786671200000 implements MigrationInterface {
  name = 'CreateAuditLogs1786671200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid,
        "userEmail" character varying(255),
        "categoria" character varying(40) NOT NULL,
        "acao" character varying(120) NOT NULL,
        "metodo" character varying(8) NOT NULL,
        "rota" character varying(500) NOT NULL,
        "alvoId" character varying(120),
        "statusCode" integer NOT NULL,
        "resultado" character varying(8) NOT NULL,
        "erro" character varying(500),
        "detalhe" jsonb,
        "ip" character varying(64),
        "userAgent" character varying(300),
        "duracaoMs" integer NOT NULL,
        "admin" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_created" ON "audit_logs" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_user_created" ON "audit_logs" ("userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_acao_created" ON "audit_logs" ("acao", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_categoria_created" ON "audit_logs" ("categoria", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}
