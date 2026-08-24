import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foto do produto da base do Live Copilot. Serve à lista de "fixar produto" do
 * cockpit: no meio da live o vendedor reconhece o item pela imagem, não pelo
 * nome do catálogo. Nula por padrão — a extração da gravação não gera foto.
 */
export class AddLiveProductImage1786670700000 implements MigrationInterface {
  name = 'AddLiveProductImage1786670700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_products" ADD COLUMN IF NOT EXISTS "imageUrl" text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_products" DROP COLUMN IF EXISTS "imageUrl"`,
    );
  }
}
