import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Colunas e restrições que existiam nas entidades mas em nenhuma migração.
 *
 * Elas nasceram em produção pelo `synchronize` e nunca foram escritas como
 * migração — então um ambiente provisionado do zero subia SEM elas. O código
 * lê `products.images`, filtra por `videos.kind` e `creators.source`, e conta
 * `ingestion_runs.productsIngested`: num banco novo, tudo isso quebrava na
 * primeira consulta. Era exatamente o que o job de drift do CI apontava.
 *
 * Duas restrições de unicidade entram junto, e são as mais sérias: sem elas o
 * banco aceita duas contas com o mesmo e-mail e duas tendências com a mesma
 * hashtag.
 *
 * Tudo é idempotente: em produção, onde as colunas já existem, a migração não
 * faz nada.
 */
export class AlinharSchemaComEntidades1786666700000 implements MigrationInterface {
  name = 'AlinharSchemaComEntidades1786666700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "images" jsonb`,
    );

    await queryRunner.query(
      `ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "kind" character varying NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_videos_kind" ON "videos" ("kind")`,
    );

    await queryRunner.query(
      `ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "productsIngested" integer NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(
      `ALTER TABLE "creators" ADD COLUMN IF NOT EXISTS "source" character varying NOT NULL DEFAULT 'seed'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_creators_source" ON "creators" ("source")`,
    );

    // Uma conta por e-mail. O app já tratava isso, mas era regra só de código:
    // duas requisições simultâneas de cadastro passavam pelas duas.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_app_users_email" ON "app_users" ("email")`,
    );

    // A hashtag é a chave natural da tendência na ingestão (o `upsert` conta
    // com ela). NULL não colide, então tendência sem hashtag continua válida.
    // O nome é o que o TypeORM gera para `@Column({ unique: true })` — mudá-lo
    // faria o drift acusar diferença de novo.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_d51fb2f9c7fa24cb4bf4e1fe3ef'
        ) THEN
          ALTER TABLE "trends"
            ADD CONSTRAINT "UQ_d51fb2f9c7fa24cb4bf4e1fe3ef" UNIQUE ("hashtag");
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trends" DROP CONSTRAINT IF EXISTS "UQ_d51fb2f9c7fa24cb4bf4e1fe3ef"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_users_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_creators_source"`);
    await queryRunner.query(
      `ALTER TABLE "creators" DROP COLUMN IF EXISTS "source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_runs" DROP COLUMN IF EXISTS "productsIngested"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_videos_kind"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN IF EXISTS "kind"`);
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "images"`,
    );
  }
}
