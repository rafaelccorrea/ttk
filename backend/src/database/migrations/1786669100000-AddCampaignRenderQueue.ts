import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fila de renderização das campanhas.
 *
 * O "Gerar vídeo completo" disparava todas as cenas dentro de UM request —
 * o mesmo padrão que o proxy da hospedagem já derrubou na redublagem, e que
 * submetia todas as gerações à fornecedora de uma vez. Com a flag no banco,
 * o clique dispara só a primeira cena e o polling avança uma por vez; a fila
 * sobrevive a restart do servidor porque o estado não mora em memória.
 */
export class AddCampaignRenderQueue1786669100000 implements MigrationInterface {
  name = 'AddCampaignRenderQueue1786669100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "renderQueue" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "renderQueue"`,
    );
  }
}
