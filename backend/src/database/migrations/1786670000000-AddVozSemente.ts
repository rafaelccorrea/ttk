import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Voz-semente do apresentador.
 *
 * O modelo de vídeo gera a voz a partir de TEXTO e não tem id de voz: cada
 * cena sorteava um timbre parecido, e a campanha saía com três ou quatro
 * vozes. `personas.seedVoiceUrl` guarda um clipe de referência (TTS da voz
 * da persona) que entra como `--audio-references` em toda cena falada;
 * `generated_media.voiceRefUrl` leva a referência até a fase 2 da composição.
 */
export class AddVozSemente1786670000000 implements MigrationInterface {
  name = 'AddVozSemente1786670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "seedVoiceUrl" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "generated_media" ADD COLUMN IF NOT EXISTS "voiceRefUrl" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generated_media" DROP COLUMN IF EXISTS "voiceRefUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "personas" DROP COLUMN IF EXISTS "seedVoiceUrl"`,
    );
  }
}
