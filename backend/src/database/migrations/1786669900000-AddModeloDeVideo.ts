import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rastreio do modelo de vídeo por cena.
 *
 * `generated_media.model` guarda qual IA gerou cada clipe; `campaign_scenes.modelo`
 * permite forçar um modelo numa cena específica para comparar. Sem isso a
 * pergunta "qual IA é melhor para cena de tela / de apresentador?" só tinha
 * resposta de memória.
 */
export class AddModeloDeVideo1786669900000 implements MigrationInterface {
  name = 'AddModeloDeVideo1786669900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generated_media" ADD COLUMN IF NOT EXISTS "model" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_scenes" ADD COLUMN IF NOT EXISTS "modelo" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaign_scenes" DROP COLUMN IF EXISTS "modelo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "generated_media" DROP COLUMN IF EXISTS "model"`,
    );
  }
}
