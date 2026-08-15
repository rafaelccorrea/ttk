import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vídeo final montado a partir das cenas.
 *
 * Sem ele a campanha entregava seis arquivos soltos, e juntar sobrava para o
 * vendedor — que é justamente a parte que ele não sabe fazer.
 */
export class AddCampaignFinalVideo1786666500000 implements MigrationInterface {
  name = 'AddCampaignFinalVideo1786666500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "finalVideoUrl" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "finalVideoUrl"`,
    );
  }
}
