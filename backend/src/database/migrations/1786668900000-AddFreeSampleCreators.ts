import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Criadores na amostra da conta gratuita.
 *
 * Mesma ideia dos produtos e vídeos: um punhado de ids congelados por 7 dias,
 * iguais para todas as contas. A coluna entra com `DEFAULT '[]'` para que a
 * amostra da semana corrente continue válida — ela só passa a ter criadores na
 * próxima virada de janela, e não numa regeneração forçada no meio da semana,
 * que é justamente o que o congelamento promete não fazer.
 */
export class AddFreeSampleCreators1786668900000 implements MigrationInterface {
  name = 'AddFreeSampleCreators1786668900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "free_samples" ADD COLUMN IF NOT EXISTS "creatorIds" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "free_samples" DROP COLUMN IF EXISTS "creatorIds"`,
    );
  }
}
