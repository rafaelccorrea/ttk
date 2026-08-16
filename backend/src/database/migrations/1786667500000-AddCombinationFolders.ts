import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pastas do Multiplicador.
 *
 * A galeria só sabia agrupar por produto — um fato do sistema, derivado de qual
 * matriz gerou o arquivo. Faltava o eixo do vendedor: "postar essa semana", "já
 * foi ao ar", "campanha de maio". Estas pastas são isso, e são opcionais: vídeo
 * sem pasta continua listado pelo produto.
 *
 * `folderId` não tem FK de propósito — apagar uma pasta nunca pode apagar
 * vídeo. O serviço zera a coluna e os arquivos voltam para "sem pasta".
 */
export class AddCombinationFolders1786667500000 implements MigrationInterface {
  name = 'AddCombinationFolders1786667500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "combination_folders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "name" character varying(60) NOT NULL,
        "color" character varying(7) NOT NULL DEFAULT '#fe2c55',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_combination_folders" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_combination_folders_user" ON "combination_folders" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "combination_videos" ADD COLUMN IF NOT EXISTS "folderId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_combination_videos_folder" ON "combination_videos" ("folderId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_combination_videos_folder"`,
    );
    await queryRunner.query(
      `ALTER TABLE "combination_videos" DROP COLUMN IF EXISTS "folderId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "combination_folders"`);
  }
}
