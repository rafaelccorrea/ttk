import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O custo real de cada chamada de IA, ao lado do que foi cobrado por ela.
 *
 * Toda a tabela de preços do PikPok é construída sobre custos de pior caso
 * calculados à mão — e conta feita à mão envelhece sem avisar: o fornecedor
 * reajusta, o prompt engorda a cada iteração, o cache pega menos do que se
 * supunha no dia em que o preço foi definido. Sem medir, a primeira notícia de
 * que a margem virou prejuízo é a fatura do mês seguinte.
 *
 * Guarda os TOKENS e não só o valor fechado em reais porque o preço do
 * fornecedor muda: com os tokens gravados, o histórico inteiro pode ser
 * reapurado com a tabela nova; com o valor fechado, o passado fica congelado
 * num preço que não vale mais.
 *
 * `chargedUnit` e `chargedAmount` vivem na mesma linha pelo mesmo motivo:
 * cruzar custo com receita depois, por fora, viraria adivinhação sobre qual
 * tabela de preços valia naquele dia.
 */
export class AddAiCostEvents1786668100000 implements MigrationInterface {
  name = 'AddAiCostEvents1786668100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_cost_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid,
        "feature" character varying NOT NULL,
        "model" character varying NOT NULL,
        "inputTokens" integer NOT NULL DEFAULT 0,
        "outputTokens" integer NOT NULL DEFAULT 0,
        "cacheReadTokens" integer NOT NULL DEFAULT 0,
        "cacheWriteTokens" integer NOT NULL DEFAULT 0,
        "audioSeconds" integer NOT NULL DEFAULT 0,
        "costBrl" numeric(12,6) NOT NULL,
        "chargedUnit" character varying NOT NULL DEFAULT 'none',
        "chargedAmount" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_cost_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_cost_events_userId" ON "ai_cost_events" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_cost_events_feature" ON "ai_cost_events" ("feature")`,
    );
    // O relatório é sempre "no período X": sem índice na data, apurar a margem
    // do mês vira varredura da tabela inteira, que só cresce.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_cost_events_createdAt" ON "ai_cost_events" ("createdAt")`,
    );
    // Tabela nova nasce com RLS ligado e sem policy — a `anon key` do Supabase
    // é pública e vai no bundle do front (ver HardenRlsDefaults). Aqui isso
    // pesa mais que o normal: são os nossos custos e as nossas margens.
    await queryRunner.query(
      `ALTER TABLE "ai_cost_events" ENABLE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_cost_events"`);
  }
}
