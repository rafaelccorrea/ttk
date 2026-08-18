import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A carteira de minutos de live — a segunda moeda da conta.
 *
 * O copiloto ao vivo deixou de gastar crédito de IA e passou a gastar minutos,
 * comprados em add-ons de hora. São moedas separadas porque o cliente compra
 * coisas diferentes: crédito é unidade de trabalho (um roteiro, uma imagem),
 * pedida item a item; hora de live é tempo de transmissão, e o que ele precisa
 * saber antes de ligar o copiloto é quantas horas ainda tem — não quantos
 * créditos vai queimar por minuto. Misturar as duas transforma cada live num
 * cálculo mental, e faz o vendedor hesitar em deixar o copiloto ligado.
 *
 * A `liveTrialBlocksUsed` da migration anterior cai aqui: ela contava blocos de
 * cortesia numa moeda que não existe mais. A cortesia agora são dez minutos
 * creditados no próprio saldo, e a data em `liveTrialGrantedAt` é a trava de
 * "uma vez por conta". A coluna some sem perda: nenhuma conta chegou a
 * consumir bloco nenhum, porque o copiloto ao vivo ainda não existe.
 */
export class AddLiveMinuteWallet1786668000000 implements MigrationInterface {
  name = 'AddLiveMinuteWallet1786668000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "liveMinutes" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "liveTrialGrantedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "liveTrialBlocksUsed"`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_minute_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "minutes" integer NOT NULL,
        "balanceAfter" integer NOT NULL,
        "kind" character varying NOT NULL,
        "reference" text,
        "description" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_minute_transactions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_minute_transactions_userId" ON "live_minute_transactions" ("userId")`,
    );
    /*
     * Índice ÚNICO na referência: é o que impede o webhook de creditar duas
     * vezes o mesmo pagamento quando o Stripe reenvia o evento — e o Stripe
     * reenvia. A checagem em código antes do insert é a primeira barreira; esta
     * é a que vale sob concorrência, quando duas entregas do mesmo evento
     * chegam juntas.
     *
     * Não precisa ser parcial: no Postgres, NULL nunca colide com NULL num
     * índice único, então os lançamentos de consumo — que não têm referência —
     * convivem à vontade. E um índice simples é o que o TypeORM gera a partir
     * da entidade, o que mantém o drift-check do CI limpo.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_minute_transactions_reference" ON "live_minute_transactions" ("reference")`,
    );

    // Toda tabela nova nasce com RLS ligado e sem policy: a `anon key` do
    // Supabase é pública e vai no bundle do front (ver HardenRlsDefaults).
    await queryRunner.query(
      `ALTER TABLE "live_minute_transactions" ENABLE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "live_minute_transactions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "liveTrialGrantedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "liveMinutes"`,
    );
  }
}
