import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Métricas de audiência da transmissão.
 *
 * Até aqui o copiloto só capturava o CHAT: a página do copiloto na web sabia
 * dizer quantas perguntas houve, mas não quantas pessoas assistiam, quando a
 * live pegou fogo nem quando esvaziou. O webcast entrega esses eventos de graça
 * (viewers, curtidas, presentes, follows, shares) e o app desktop passa a
 * agregá-los em instantâneos de ~30s — `live_run_metrics` é a série temporal, e
 * as colunas novas em `live_runs` são o resumo que a listagem mostra sem ter
 * que somar a série (o mesmo raciocínio de `messagesSeen` e companhia).
 *
 * Nada aqui identifica espectador: são contadores da sala, do lado de dentro da
 * mesma fronteira de LGPD do chat.
 */
export class AddLiveRunMetrics1786669500000 implements MigrationInterface {
  name = 'AddLiveRunMetrics1786669500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_run_metrics" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "liveRunId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "capturedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "viewerCount" integer,
        "likes" integer NOT NULL DEFAULT 0,
        "gifts" integer NOT NULL DEFAULT 0,
        "giftDiamonds" integer NOT NULL DEFAULT 0,
        "follows" integer NOT NULL DEFAULT 0,
        "shares" integer NOT NULL DEFAULT 0,
        "joins" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_run_metrics" PRIMARY KEY ("id"),
        CONSTRAINT "FK_live_run_metrics_run" FOREIGN KEY ("liveRunId")
          REFERENCES "live_runs"("id") ON DELETE CASCADE
      )
    `);

    // A série é sempre lida por run e ordenada no tempo — é o gráfico da
    // página de detalhe, uma consulta só, sempre com este par no WHERE/ORDER.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_run_metrics_run_capturedAt"
         ON "live_run_metrics" ("liveRunId", "capturedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_run_metrics_userId"
         ON "live_run_metrics" ("userId")`,
    );

    await queryRunner.query(`
      ALTER TABLE "live_runs"
        ADD COLUMN IF NOT EXISTS "peakViewers" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalLikes" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalGifts" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalGiftDiamonds" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalFollows" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalShares" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "live_runs"
        DROP COLUMN IF EXISTS "totalShares",
        DROP COLUMN IF EXISTS "totalFollows",
        DROP COLUMN IF EXISTS "totalGiftDiamonds",
        DROP COLUMN IF EXISTS "totalGifts",
        DROP COLUMN IF EXISTS "totalLikes",
        DROP COLUMN IF EXISTS "peakViewers"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "live_run_metrics"`);
  }
}
