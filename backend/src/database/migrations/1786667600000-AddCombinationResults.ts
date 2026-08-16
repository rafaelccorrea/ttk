import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Desempenho por vídeo montado — o começo do ciclo análise → aprendizado.
 *
 * Até aqui a plataforma acompanhava o criativo até o download e perdia o rastro
 * dali em diante: o vendedor postava 30 vídeos e voltava na semana seguinte sem
 * saber qual gancho tinha segurado o scroll.
 *
 * As colunas são ANULÁVEIS de propósito, não `default 0`. Lançar resultado é
 * opcional, e `null` ("não informado") precisa ser distinguível de zero ("foi ao
 * ar e não rendeu") — senão todo vídeo não lançado entraria como fracasso na
 * média da peça e o ranking diria o contrário da verdade.
 */
export class AddCombinationResults1786667600000 implements MigrationInterface {
  name = 'AddCombinationResults1786667600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "combination_videos" ADD COLUMN IF NOT EXISTS "views" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "combination_videos" ADD COLUMN IF NOT EXISTS "sales" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "combination_videos" ADD COLUMN IF NOT EXISTS "postUrl" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "combination_videos" DROP COLUMN IF EXISTS "postUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "combination_videos" DROP COLUMN IF EXISTS "sales"`,
    );
    await queryRunner.query(
      `ALTER TABLE "combination_videos" DROP COLUMN IF EXISTS "views"`,
    );
  }
}
