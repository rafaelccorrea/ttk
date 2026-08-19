import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Etiqueta de produto no clipe do multiplicador.
 *
 * A lista de clipes é global por usuário e o rótulo é o nome do arquivo — quem
 * vende mais de um produto não sabia qual produto aparecia em qual clipe.
 * `NULL` nos clipes antigos e nos genéricos (gancho reaproveitado entre
 * produtos).
 */
export class AddClipProduto1786669400000 implements MigrationInterface {
  name = 'AddClipProduto1786669400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "combination_clips" ADD COLUMN IF NOT EXISTS "produto" character varying(60)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "combination_clips" DROP COLUMN IF EXISTS "produto"`,
    );
  }
}
