import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O roteiro passa a dizer COMO o produto se usa, em vez de o modelo de vídeo
 * adivinhar.
 *
 *  - `campaigns.comoUsa`: gesto de uso real ("escreve no papel", "passa nos
 *    lábios"), deduzido uma vez pelo roteirista e injetado no prompt de toda
 *    cena de demonstração;
 *  - `campaign_scenes.seguraProduto`: cena de apresentador que manuseia o
 *    produto, marcada pelo roteiro. Substitui a regex sobre a acaoVisual, que
 *    não pegava ações de uso real ("passa o batom") e deixava a cena sem a
 *    composição retrato+produto.
 */
export class AddComoUsaESeguraProduto1786669300000 implements MigrationInterface {
  name = 'AddComoUsaESeguraProduto1786669300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "comoUsa" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_scenes" ADD COLUMN IF NOT EXISTS "seguraProduto" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaign_scenes" DROP COLUMN IF EXISTS "seguraProduto"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "comoUsa"`,
    );
  }
}
