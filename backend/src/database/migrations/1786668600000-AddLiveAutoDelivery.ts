import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Modo automático do Live Copilot: o app passa a DIGITAR a resposta no chat.
 *
 * Até aqui `live_replies` guardava o que o copiloto escreveu e nada mais — no
 * modo painel a resposta nasce e morre na tela do vendedor, e "entrega" não era
 * um conceito. Com o envio de verdade a mesma linha precisa contar a história do
 * que aconteceu DEPOIS de ela existir: entrou na fila, saiu, falhou, ou perdeu a
 * hora. É esse ciclo que estas colunas acrescentam.
 *
 * O default é `nao_aplica`, e não `pendente`, de propósito. A esmagadora maioria
 * das respostas continua sendo de run em modo painel, onde nada é enviado; se
 * elas nascessem `pendente`, ficariam pendentes para sempre e toda métrica de
 * entrega — taxa de sucesso, tempo de fila, falhas por live — leria como um
 * sistema quebrado. `nao_aplica` diz o que é verdade: esta resposta nunca teve
 * envio para dar certo ou errado.
 *
 * `liveAutoAcceptedAt` em `app_users` é o aceite do termo de risco. Automatizar
 * comentário viola os Termos do TikTok e pode custar a conta do vendedor, então
 * o backend recusa ligar o modo automático de quem não carimbou esta data — a
 * decisão é dele, e precisa estar registrada com hora antes do primeiro envio.
 */
export class AddLiveAutoDelivery1786668600000 implements MigrationInterface {
  name = 'AddLiveAutoDelivery1786668600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "live_replies"
        ADD COLUMN IF NOT EXISTS "deliveryStatus" character varying NOT NULL DEFAULT 'nao_aplica',
        ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "failureReason" text,
        ADD COLUMN IF NOT EXISTS "deliveryAttempts" integer NOT NULL DEFAULT 0
    `);

    /*
     * A fila é consultada a cada poucos segundos durante a live, e a varredura
     * de descarte roda sobre todas as runs de uma vez. Nos dois casos o que
     * seleciona é o status — e `pendente` é uma fração minúscula da tabela, que
     * acumula uma linha por pergunta de toda live já transmitida.
     */
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_replies_deliveryStatus" ON "live_replies" ("deliveryStatus")`,
    );

    await queryRunner.query(`
      ALTER TABLE "live_runs"
        ADD COLUMN IF NOT EXISTS "repliesSent" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "deliveryFailures" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "app_users"
        ADD COLUMN IF NOT EXISTS "liveAutoAcceptedAt" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "liveAutoAcceptedVersion" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "app_users"
        DROP COLUMN IF EXISTS "liveAutoAcceptedVersion",
        DROP COLUMN IF EXISTS "liveAutoAcceptedAt"
    `);
    await queryRunner.query(`
      ALTER TABLE "live_runs"
        DROP COLUMN IF EXISTS "deliveryFailures",
        DROP COLUMN IF EXISTS "repliesSent"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_live_replies_deliveryStatus"`,
    );
    await queryRunner.query(`
      ALTER TABLE "live_replies"
        DROP COLUMN IF EXISTS "deliveryAttempts",
        DROP COLUMN IF EXISTS "failureReason",
        DROP COLUMN IF EXISTS "sentAt",
        DROP COLUMN IF EXISTS "deliveryStatus"
    `);
  }
}
