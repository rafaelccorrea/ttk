import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `videos.playbackExpiresAt`: validade da URL temporária de reprodução.
 *
 * Resolver o MP4 no fornecedor leva de 6 a 17 segundos — era o que fazia o
 * player parecer travado. Com a validade no banco, só a primeira exibição paga
 * esse custo e o cache sobrevive a restart. NULL = URL permanente (S3).
 */
export class AddVideoPlaybackExpiry1786665800000 implements MigrationInterface {
  name = 'AddVideoPlaybackExpiry1786665800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "playbackExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP COLUMN IF EXISTS "playbackExpiresAt"`,
    );
  }
}
