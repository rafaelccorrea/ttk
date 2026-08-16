import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Arquivo das respostas cruas do fornecedor.
 *
 * A requisição é paga e não recupera. Sem guardar o JSON como ele chegou, todo
 * parse errado — campo com outro nome, moeda trocada, valor que já vinha
 * zerado na origem — obrigava a pagar tudo de novo só para enxergar o
 * problema. E número questionado na vitrine não tinha como ser auditado.
 */
export class AddApiRawResponses1786667200000 implements MigrationInterface {
  name = 'AddApiRawResponses1786667200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "api_raw_responses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "endpoint" character varying NOT NULL,
        "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "subject" character varying,
        "httpStatus" integer NOT NULL DEFAULT 0,
        "code" integer NOT NULL DEFAULT 0,
        "message" text,
        "itemCount" integer NOT NULL DEFAULT 0,
        "payload" jsonb,
        "purpose" character varying(16) NOT NULL DEFAULT 'coleta',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_api_raw_responses" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_api_raw_responses_endpoint" ON "api_raw_responses" ("endpoint")`,
    );
    // É por aqui que se pergunta "o que o fornecedor disse sobre ESTE produto".
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_api_raw_responses_subject" ON "api_raw_responses" ("subject")`,
    );
    // A poda por idade varre por data.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_api_raw_responses_createdAt" ON "api_raw_responses" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "api_raw_responses"`);
  }
}
