import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * De qual imagem cada cena é animada.
 *
 * Sem isso, TODA cena partia do retrato do apresentador — inclusive as de
 * demonstração. Como a IA não sabe como é o produto do vendedor, ela inventava
 * um objeto parecido, e o anúncio acabava mostrando algo que não é o que ele
 * vende. Agora a cena de demonstração parte da foto real que ele enviou.
 */
export class AddSceneKind1786666400000 implements MigrationInterface {
  name = 'AddSceneKind1786666400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaign_scenes" ADD COLUMN IF NOT EXISTS "tipo" character varying NOT NULL DEFAULT 'apresentador'`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_scenes" ADD COLUMN IF NOT EXISTS "baseImageUrl" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "campaign_scenes" DROP COLUMN IF EXISTS "baseImageUrl"`);
    await queryRunner.query(`ALTER TABLE "campaign_scenes" DROP COLUMN IF EXISTS "tipo"`);
  }
}
