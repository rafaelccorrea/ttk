import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Legendas queimadas no vídeo final viram ESCOLHA da campanha.
 *
 * Eram sempre gravadas — e quem publica com legenda automática do próprio
 * TikTok acabava com duas legendas sobrepostas. O padrão continua ligado (a
 * maioria assiste sem som), mas quem não quer, desliga.
 */
export class AddCampaignSubtitles1786669200000 implements MigrationInterface {
  name = 'AddCampaignSubtitles1786669200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "subtitles" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "subtitles"`,
    );
  }
}
