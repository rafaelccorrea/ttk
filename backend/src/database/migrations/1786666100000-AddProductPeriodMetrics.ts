import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Métricas por período direto no produto.
 *
 * Antes, o ranking somava `product_metrics_daily`, mas a ingestão só grava o
 * dia corrente — então TODO produto tinha exatamente 1 dia de dado e os
 * filtros de 7/30/90 dias devolviam sempre o mesmo resultado, com crescimento
 * sempre nulo.
 *
 * O fornecedor já entrega os acumulados de 7/30/60/90 dias no mesmo request
 * (10 produtos por chamada). Guardar aqui torna o período REAL sem precisar
 * reconstruir série diária — e o crescimento vira 30d contra (60d − 30d).
 */
export class AddProductPeriodMetrics1786666100000 implements MigrationInterface {
  name = 'AddProductPeriodMetrics1786666100000';

  private readonly colunas = [
    'sales7d', 'sales30d', 'sales60d', 'sales90d',
    'revenue7d', 'revenue30d', 'revenue60d', 'revenue90d',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const col of this.colunas) {
      const tipo = col.startsWith('sales')
        ? 'integer NOT NULL DEFAULT 0'
        : 'numeric(14,2) NOT NULL DEFAULT 0';
      await queryRunner.query(
        `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`,
      );
    }
    // Ordenação padrão da vitrine usa vendas de 30 dias.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_products_sales30d" ON "products" ("sales30d")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_sales30d"`);
    for (const col of this.colunas) {
      await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
