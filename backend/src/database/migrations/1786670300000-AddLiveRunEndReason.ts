import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Motivo do fim de uma transmissão, legível por máquina.
 *
 * `live_runs.errorMessage` sempre foi o texto humano; com o teto de duração
 * por plano (e, adiante, o detector de aviso do TikTok) o desktop e o
 * histórico precisam DECIDIR a partir do motivo — e decidir por parsing de
 * frase é o bug esperando o primeiro ajuste de redação. Valores:
 * 'manual' | 'limite_duracao' | 'creditos' | 'aviso_tiktok' | 'erro'.
 * Nulo nas runs anteriores à coluna.
 */
export class AddLiveRunEndReason1786670300000 implements MigrationInterface {
  name = 'AddLiveRunEndReason1786670300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_runs" ADD COLUMN IF NOT EXISTS "endReason" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_runs" DROP COLUMN IF EXISTS "endReason"`,
    );
  }
}
