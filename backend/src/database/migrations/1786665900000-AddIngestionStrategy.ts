import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estratégia de ingestão em camadas, dimensionada pela cota mensal.
 *
 * - `products.tiktokProductId`: chave do produto na API do fornecedor. Antes só
 *   existia embutida no `externalId` ("echotik-<id>"), o que impedia consulta
 *   em lote de forma limpa.
 * - `products.lastRefreshedAt` / `lastEnrichedAt` / `historyBackfilled`:
 *   controlam o rodízio. Refresh é barato (10 produtos por request), enrich é
 *   caro (~4 requests por produto), backfill é uma vez só.
 * - `ingestion_settings.*`: parâmetros das camadas, ajustáveis sem deploy.
 */
export class AddIngestionStrategy1786665900000 implements MigrationInterface {
  name = 'AddIngestionStrategy1786665900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tiktokProductId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lastRefreshedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lastEnrichedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "historyBackfilled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_products_tiktokProductId" ON "products" ("tiktokProductId")`,
    );

    // Preenche a coluna nova a partir do externalId já existente.
    await queryRunner.query(
      `UPDATE "products" SET "tiktokProductId" = replace("externalId", 'echotik-', '')
       WHERE "externalId" LIKE 'echotik-%' AND "tiktokProductId" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "catalogSize" integer NOT NULL DEFAULT 2500`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "enrichPerRun" integer NOT NULL DEFAULT 125`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "discoveryPagesPerCategory" integer NOT NULL DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_settings" ADD COLUMN IF NOT EXISTS "discoveryHour" integer NOT NULL DEFAULT 6`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of [
      'discoveryHour',
      'discoveryPagesPerCategory',
      'enrichPerRun',
      'catalogSize',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "ingestion_settings" DROP COLUMN IF EXISTS "${col}"`,
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_tiktokProductId"`);
    for (const col of [
      'historyBackfilled',
      'lastEnrichedAt',
      'lastRefreshedAt',
      'tiktokProductId',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "products" DROP COLUMN IF EXISTS "${col}"`,
      );
    }
  }
}
