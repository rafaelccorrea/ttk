import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Preço por modelo na Fábrica.
 *
 * A cena deixou de custar 60 créditos fixos: Kling Turbo (mudo) e Seedance
 * 2.0 (fala) custam 3× de diferença na fornecedora, e o preço passou a seguir
 * o modelo escolhido. `generated_media.chargedCredits` guarda o que FOI
 * cobrado em cada geração, para o estorno e o `creditsSpent` da campanha
 * devolverem/descontarem a quantia certa. Nulo = tabela (gerações antigas).
 */
export class AddChargedCredits1786670100000 implements MigrationInterface {
  name = 'AddChargedCredits1786670100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generated_media" ADD COLUMN IF NOT EXISTS "chargedCredits" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generated_media" DROP COLUMN IF EXISTS "chargedCredits"`,
    );
  }
}
