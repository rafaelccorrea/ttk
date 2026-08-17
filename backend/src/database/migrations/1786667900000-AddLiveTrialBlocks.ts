import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O contador de blocos de cortesia do Live Copilot.
 *
 * Cada conta ganha dez minutos de copiloto ao vivo para ver a coisa
 * respondendo o próprio chat — uma vez, não por live. É por isso que o contador
 * fica em `app_users` e não em `live_sessions`: preso à sessão, bastaria abrir
 * uma base nova a cada dez minutos de transmissão para nunca pagar.
 *
 * Inteiro em vez de booleano ou de um `liveTrialUsedAt`: assim, esticar a
 * cortesia numa campanha é mudar `LIVE_TRIAL_BLOCKS` no código, sem migration e
 * sem ter que reinterpretar o que já está gravado nas contas antigas.
 */
export class AddLiveTrialBlocks1786667900000 implements MigrationInterface {
  name = 'AddLiveTrialBlocks1786667900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "liveTrialBlocksUsed" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "liveTrialBlocksUsed"`,
    );
  }
}
