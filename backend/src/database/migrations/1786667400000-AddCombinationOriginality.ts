import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Etiqueta de originalidade no Multiplicador.
 *
 * A matriz G×C×A reaproveita os mesmos pedaços entre os vídeos: dois arquivos
 * que compartilham o gancho são quase o mesmo vídeo nos 3 segundos que decidem
 * o scroll. Sem uma ordem sugerida, o vendedor posta a matriz na ordem do
 * código (G1C1A1, G1C1A2, G1C2A1…) — ou seja, os mais parecidos em sequência.
 *
 * Estas colunas guardam o resultado do cálculo feito na montagem, para a
 * galeria e a tela do plano mostrarem a etiqueta sem recalcular nada.
 */
export class AddCombinationOriginality1786667400000
  implements MigrationInterface
{
  name = 'AddCombinationOriginality1786667400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "combination_videos" ADD COLUMN IF NOT EXISTS "originality" character varying(20) NOT NULL DEFAULT 'original'`,
    );
    // Zero significa "montado antes desta migração": a tela trata como sem
    // ordem sugerida e cai de volta na ordem do código.
    await queryRunner.query(
      `ALTER TABLE "combination_videos" ADD COLUMN IF NOT EXISTS "postOrder" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "combination_videos" DROP COLUMN IF EXISTS "postOrder"`,
    );
    await queryRunner.query(
      `ALTER TABLE "combination_videos" DROP COLUMN IF EXISTS "originality"`,
    );
  }
}
