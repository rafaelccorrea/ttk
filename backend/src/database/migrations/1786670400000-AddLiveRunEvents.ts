import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trilha de auditoria da transmissão (detector de aviso do TikTok e pin de
 * produto) + o CONTEXTO na telemetria de seletor.
 *
 * `live_run_events`: o que o app fez ou viu durante a live além do chat —
 * "viu um aviso e pausou", "tentou fixar produto e falhou". Responde perguntas
 * que chegam depois do fato, então não pode viver só em log de processo.
 *
 * `live_selector_failures.context`: com quatro cascatas em produção (campo,
 * botão de enviar, banner de aviso, botão de encerrar), um relatório de falha
 * sem dizer QUAL cascata quebrou é ambíguo — e cada cascata tem dono e
 * urgência diferentes (o campo quebra o envio; o aviso quebra a proteção).
 */
export class AddLiveRunEvents1786670400000 implements MigrationInterface {
  name = 'AddLiveRunEvents1786670400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_run_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "liveRunId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "tipo" character varying NOT NULL,
        "acao" character varying,
        "detalhe" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_run_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_live_run_events_run" FOREIGN KEY ("liveRunId")
          REFERENCES "live_runs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_run_events_liveRunId" ON "live_run_events" ("liveRunId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_run_events_userId" ON "live_run_events" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "live_selector_failures" ADD COLUMN IF NOT EXISTS "context" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_selector_failures" DROP COLUMN IF EXISTS "context"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "live_run_events"`);
  }
}
