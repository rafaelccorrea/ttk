import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Live Copilot, fase 0: a base de conhecimento da live.
 *
 * O vendedor sobe a gravação de uma live de 2-4h, o backend transcreve e extrai
 * o que foi realmente vendido — produto, preço, variações, frete, promoção,
 * objeções e as perguntas que o chat repete a noite inteira. Essa base fica
 * editável na web; numa fase futura um app desktop vai usá-la para responder o
 * chat ao vivo. Nada disso está aqui: estas tabelas são só o conhecimento.
 *
 * `live_sessions` é deliberadamente uma sessão de PROCESSAMENTO, não uma
 * transmissão. A tentação era pendurar a base na live em que ela foi capturada,
 * mas o mesmo catálogo é vendido em dezenas de transmissões seguidas; amarrar as
 * duas coisas obrigaria a reprocessar (e repagar) a gravação a cada nova live
 * para chegar exatamente no mesmo conhecimento. Separado, a base é criada uma
 * vez, corrigida à mão e reutilizada à vontade.
 *
 * `live_products` e `live_faq` carregam `origin` porque o que a IA extraiu e o
 * que o vendedor digitou não valem a mesma coisa na hora de reprocessar: o que
 * é 'manual' não pode ser sobrescrito por uma extração posterior.
 */
export class AddLiveCopilot1786667700000 implements MigrationInterface {
  name = 'AddLiveCopilot1786667700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "title" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'rascunho',
        "sourceKind" character varying NOT NULL DEFAULT 'gravada',
        "audioKey" text,
        "durationSeconds" integer,
        "transcript" text,
        "creditsSpent" integer NOT NULL DEFAULT 0,
        "errorMessage" text,
        -- COM fuso: a entidade declara 'timestamptz' e é o padrão do repo para
        -- marcas de tempo de processamento. Sem o WITH TIME ZONE a coluna nasce
        -- divergente da entidade e o offset se perde na gravação.
        "processingStartedAt" TIMESTAMP WITH TIME ZONE,
        "pendingTranscribeBlocks" integer NOT NULL DEFAULT 0,
        "pendingExtractCharge" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_sessions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_sessions_userId" ON "live_sessions" ("userId")`,
    );

    /*
     * Reparos para os bancos de desenvolvimento em que uma versão anterior desta
     * migration já rodou (o CREATE TABLE acima é IF NOT EXISTS e não os
     * alcançaria). Tudo idempotente e inócuo num banco limpo.
     */
    await queryRunner.query(
      `ALTER TABLE "live_sessions" ALTER COLUMN "processingStartedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "live_sessions" ADD COLUMN IF NOT EXISTS "pendingTranscribeBlocks" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "live_sessions" ADD COLUMN IF NOT EXISTS "pendingExtractCharge" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "liveSessionId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "priceBrl" numeric(12,2),
        "variants" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "shippingInfo" text,
        "promo" text,
        "aliases" text array NOT NULL DEFAULT '{}'::text[],
        "confidence" numeric(3,2),
        "origin" character varying NOT NULL DEFAULT 'ia',
        "sourceStartSec" integer,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_products" PRIMARY KEY ("id")
      )
    `);
    // O nome do índice é parte do contrato com a entidade: o TypeORM só
    // reconhece o que `@Index('...')` declara, e um nome diferente aqui faria a
    // checagem de drift pedir DROP + CREATE a cada build. Daí o par
    // `DROP IF EXISTS` do nome antigo + `CREATE` com o nome da entidade.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_live_products_session"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_products_liveSessionId" ON "live_products" ("liveSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_products_userId" ON "live_products" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_faq" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "liveSessionId" uuid NOT NULL,
        "liveProductId" uuid,
        "userId" uuid NOT NULL,
        "question" text NOT NULL,
        "answer" text NOT NULL,
        "kind" character varying NOT NULL DEFAULT 'faq',
        "origin" character varying NOT NULL DEFAULT 'ia',
        "priority" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_faq" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_live_faq_session"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_faq_liveSessionId" ON "live_faq" ("liveSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_faq_userId" ON "live_faq" ("userId")`,
    );
    // A entidade declara este índice na FK do produto; sem criá-lo aqui o
    // schema nunca converge.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_faq_liveProductId" ON "live_faq" ("liveProductId")`,
    );

    // `ADD CONSTRAINT` não aceita `IF NOT EXISTS` no Postgres e o CI roda esta
    // migration duas vezes num banco limpo — daí a checagem em pg_constraint.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_live_products_session'
        ) THEN
          ALTER TABLE "live_products"
            ADD CONSTRAINT "FK_live_products_session"
            FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id")
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_live_faq_session'
        ) THEN
          ALTER TABLE "live_faq"
            ADD CONSTRAINT "FK_live_faq_session"
            FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id")
            ON DELETE CASCADE;
        END IF;

        -- O FAQ sobrevive ao produto: pergunta sobre frete ou prazo continua
        -- valendo mesmo depois de o vendedor apagar o item do catálogo.
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_live_faq_product'
        ) THEN
          ALTER TABLE "live_faq"
            ADD CONSTRAINT "FK_live_faq_product"
            FOREIGN KEY ("liveProductId") REFERENCES "live_products"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // RLS deny-all, sem policy nenhuma: a API fala com o banco como owner e
    // ignora RLS, então nada aqui muda para a aplicação. O que muda é o resto do
    // mundo — a `anon key` do Supabase é pública, vai no bundle do front, e uma
    // tabela sem RLS nasce legível e truncável por qualquer visitante. Foi
    // exatamente o que aconteceu com `api_raw_responses` em produção. Aqui o
    // estrago seria pior: transcrição e catálogo inteiro do vendedor.
    for (const tabela of ['live_sessions', 'live_products', 'live_faq']) {
      await queryRunner.query(
        `ALTER TABLE "${tabela}" ENABLE ROW LEVEL SECURITY`,
      );
    }
  }

  /**
   * Ordem inversa das dependências. E, como nas migrations de RLS, o rollback
   * jamais devolve GRANT público — desfazer schema não pode reabrir acesso.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "live_faq"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "live_products"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "live_sessions"`);
  }
}
