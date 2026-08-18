import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Os marcadores de cobrança em aberto de uma sessão do Live Copilot.
 *
 * A `AddLiveCopilot` criou as três tabelas sem eles, e as colunas nasceram
 * depois, na entidade, junto com o estorno de sessão morta — em ambiente que já
 * tinha aplicado aquela migration o schema ficou para trás e toda leitura de
 * `live_sessions` quebrava com "column does not exist". Por isso o acréscimo
 * vem numa migration própria em vez de editar a anterior: mexer numa migration
 * já registrada não reexecuta nada, e o banco continuaria divergente.
 *
 * O que eles guardam: o pipeline debita ANTES de trabalhar (é como o `charge`
 * funciona), então um processo que morre no meio — deploy, OOM, restart — não
 * deixa exceção nenhuma para disparar o estorno. Estes dois campos são o rastro
 * durável do que foi cobrado e ainda não virou entrega, e é só por eles que o
 * cron consegue devolver o crédito de uma sessão cujo processo já não existe.
 */
export class AddLivePendingCharges1786667800000 implements MigrationInterface {
  name = 'AddLivePendingCharges1786667800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_sessions" ADD COLUMN IF NOT EXISTS "pendingTranscribeBlocks" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "live_sessions" ADD COLUMN IF NOT EXISTS "pendingExtractCharge" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_sessions" DROP COLUMN IF EXISTS "pendingExtractCharge"`,
    );
    await queryRunner.query(
      `ALTER TABLE "live_sessions" DROP COLUMN IF EXISTS "pendingTranscribeBlocks"`,
    );
  }
}
