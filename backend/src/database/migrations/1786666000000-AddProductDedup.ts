import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deduplicação de produtos.
 *
 * `dedupKey`  — assinatura normalizada do título, para agrupar o mesmo produto
 *               anunciado por vendedores ou variações diferentes.
 * `isDuplicate` — marca a cópia. Não apagamos: o registro segue no banco com
 *               histórico de métricas, só sai das listagens.
 */
export class AddProductDedup1786666000000 implements MigrationInterface {
  name = 'AddProductDedup1786666000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "dedupKey" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "isDuplicate" boolean NOT NULL DEFAULT false`,
    );
    // O filtro entra em toda listagem: sem índice, vira varredura completa.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_products_isDuplicate" ON "products" ("isDuplicate")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_products_dedupKey" ON "products" ("dedupKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_dedupKey"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_isDuplicate"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "isDuplicate"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "dedupKey"`);
  }
}
