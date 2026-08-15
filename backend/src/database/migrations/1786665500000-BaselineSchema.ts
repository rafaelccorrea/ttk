import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline do schema anterior ao módulo `stores`.
 *
 * Até aqui o projeto vivia de `synchronize: true`, então nenhum ambiente novo
 * conseguia ser provisionado sem subir a aplicação em modo desenvolvimento.
 * Esta migration reproduz exatamente o DDL que o TypeORM geraria para as
 * entidades existentes — mesmos nomes de constraint e índice — para que um
 * banco limpo chegue ao mesmo estado sem depender de `synchronize`.
 *
 * O DDL é idempotente: bancos que já foram sincronizados aplicam esta migration
 * sem efeito, apenas registrando-a no histórico.
 */
export class BaselineSchema1786665500000 implements MigrationInterface {
  name = 'BaselineSchema1786665500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ------------------------------------------------------------- Usuários

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_users" (
        "id" uuid NOT NULL,
        "email" character varying NOT NULL,
        "displayName" character varying,
        "plan" character varying NOT NULL DEFAULT 'free',
        "credits" integer NOT NULL DEFAULT '0',
        "passwordHash" character varying,
        "emailConfirmedAt" TIMESTAMP WITH TIME ZONE,
        "confirmationToken" character varying,
        "confirmationSentAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_9b97e4fbff9c2f3918fda27f999" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_a2dfb45e790c45212d56169647" ON "app_users" ("confirmationToken")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credit_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "amount" integer NOT NULL,
        "balanceAfter" integer NOT NULL,
        "kind" character varying NOT NULL,
        "action" character varying,
        "reference" character varying,
        "description" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_a408319811d1ab32832ec86fc2c" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_2121be176f72337ccf7cc4ef04" ON "credit_transactions" ("userId")`,
    );

    // -------------------------------------------------------------- Catálogo

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "externalId" character varying,
        "title" character varying NOT NULL,
        "storeName" character varying,
        "category" character varying NOT NULL,
        "price" numeric(12,2) NOT NULL DEFAULT '0',
        "imageUrl" character varying,
        "rating" numeric(3,1),
        "radarScore" integer,
        "tiktokUrl" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_078766bd87e61a8a249a9667664" UNIQUE ("externalId"),
        CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_c3932231d2385ac248d0888d95" ON "products" ("category")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_metrics_daily" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "productId" uuid NOT NULL,
        "date" date NOT NULL,
        "sales" integer NOT NULL DEFAULT '0',
        "revenue" numeric(14,2) NOT NULL DEFAULT '0',
        CONSTRAINT "UQ_48eb866e298aad5d1b17e26cd3a" UNIQUE ("productId", "date"),
        CONSTRAINT "PK_a1232ab90fbdd29b59f00a3233f" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_72bd39df46f8b68baa518aef37" ON "product_metrics_daily" ("productId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_c54f6e97497639a57a381cc537" ON "product_metrics_daily" ("date")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_favorites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "productId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_f1234056bc59c719e6b8536e21f" UNIQUE ("userId", "productId"),
        CONSTRAINT "PK_731c5d4877a8511f3bd5d7e6c10" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_9599d7698cbd231acf287d7c56" ON "product_favorites" ("userId")`,
    );

    // ---------------------------------------------------------------- Vídeos

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "externalId" character varying,
        "caption" text NOT NULL,
        "creatorHandle" character varying NOT NULL,
        "views" integer NOT NULL DEFAULT '0',
        "likes" integer NOT NULL DEFAULT '0',
        "revenueEstimate" numeric(14,2) NOT NULL DEFAULT '0',
        "postedAt" date NOT NULL,
        "videoUrl" character varying,
        "thumbnailUrl" character varying,
        "playbackUrl" character varying,
        "transcript" text,
        "productId" uuid,
        "category" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_6783f3e0d59768f5a4ccbf142d9" UNIQUE ("externalId"),
        CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_9d4a85ef57648e1ba768fbdafd" ON "videos" ("category")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "saved_videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "videoId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_53b7db4d752ddb98425aca87bf1" UNIQUE ("userId", "videoId"),
        CONSTRAINT "PK_4902aea14b487174971bc6f00e8" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_6f55d21959f723def0df544505" ON "saved_videos" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "creators" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "handle" character varying NOT NULL,
        "name" character varying NOT NULL,
        "followers" integer NOT NULL DEFAULT '0',
        "gmvPeriod" numeric(14,2) NOT NULL DEFAULT '0',
        "salesPeriod" integer NOT NULL DEFAULT '0',
        "category" character varying NOT NULL,
        "avatarUrl" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_dec6d0c8c47e2c4540654bf9190" UNIQUE ("handle"),
        CONSTRAINT "PK_b27dd693f7df17bbfc21f00166a" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ad332798156a74f7bb60902ce9" ON "creators" ("category")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trends" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying NOT NULL,
        "hashtag" character varying,
        "views" bigint NOT NULL DEFAULT '0',
        "growthRate" numeric(5,2) NOT NULL DEFAULT '0',
        "category" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_4de18eea43d948e5ea66520e0e8" PRIMARY KEY ("id")
      )
    `);

    // ---------------------------------------------------------------- Estúdio

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scripts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "type" character varying NOT NULL,
        "productName" character varying NOT NULL,
        "productDescription" text,
        "content" text NOT NULL,
        "model" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_399d1c469ffd6bac4e061e5fd8c" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_e7faf6177a65710e86d49c3c87" ON "scripts" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prompt_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying NOT NULL,
        "mediaType" character varying NOT NULL,
        "durationSec" integer,
        "niches" text NOT NULL,
        "tags" text NOT NULL,
        "template" text NOT NULL,
        "fields" text NOT NULL,
        "previewUrl" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_d8621cc428ff586db3e3a8f5b74" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "generated_media" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "kind" character varying NOT NULL,
        "prompt" text NOT NULL,
        "aspectRatio" character varying NOT NULL DEFAULT '9:16',
        "status" character varying NOT NULL DEFAULT 'queued',
        "phase" character varying NOT NULL DEFAULT 'image',
        "requestId" character varying,
        "imageUrl" character varying,
        "outputUrl" character varying,
        "error" character varying,
        "refunded" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ff88a0b49d3b1a345120a3a99dc" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_f1a9b7f90509aa9a317e6aa20a" ON "generated_media" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "combination_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "sigla" character varying(10) NOT NULL,
        "format" character varying NOT NULL,
        "hooks" text NOT NULL,
        "bodies" text NOT NULL,
        "ctas" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_504eaff6200e2efeb029af43323" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_a17d148dd84d47bbcb45401c4c" ON "combination_plans" ("userId")`,
    );

    // ---------------------------------------------------- Suporte e ingestão

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "sender" character varying(10) NOT NULL,
        "text" text NOT NULL,
        "readByAgent" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_2aa37479e71ef29cbf4dba2b1a2" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_a77fbd88d1a6a253abe1f49d66" ON "support_messages" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ingestion_settings" (
        "id" integer NOT NULL DEFAULT '1',
        "cronExpr" character varying NOT NULL DEFAULT '0 0 6 * * *',
        "enabled" boolean NOT NULL DEFAULT true,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_828ccf336743825c563db671593" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ingestion_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trigger" character varying(10) NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'running',
        "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "finishedAt" TIMESTAMP,
        "hashtagsFetched" integer NOT NULL DEFAULT '0',
        "creatorsFetched" integer NOT NULL DEFAULT '0',
        "videosUpserted" integer NOT NULL DEFAULT '0',
        "productsEnriched" integer NOT NULL DEFAULT '0',
        "error" text,
        CONSTRAINT "PK_e9476c02c52a0dac026b859858a" PRIMARY KEY ("id")
      )
    `);

    // ------------------------------------------------------ Chaves estrangeiras

    await this.addForeignKey(
      queryRunner,
      'product_metrics_daily',
      'FK_72bd39df46f8b68baa518aef379',
      '"productId"',
      'products',
      'CASCADE',
    );
    await this.addForeignKey(
      queryRunner,
      'product_favorites',
      'FK_9e77761f6faae49a6cb68182f1a',
      '"productId"',
      'products',
      'CASCADE',
    );
    await this.addForeignKey(
      queryRunner,
      'videos',
      'FK_4e93b7c54da94d17a808db66777',
      '"productId"',
      'products',
      'SET NULL',
    );
    await this.addForeignKey(
      queryRunner,
      'saved_videos',
      'FK_cb126ec9bd757700d47f6c14122',
      '"videoId"',
      'videos',
      'CASCADE',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Ordem inversa das dependências de chave estrangeira.
    for (const table of [
      'ingestion_runs',
      'ingestion_settings',
      'support_messages',
      'combination_plans',
      'generated_media',
      'prompt_templates',
      'scripts',
      'trends',
      'creators',
      'saved_videos',
      'videos',
      'product_favorites',
      'product_metrics_daily',
      'products',
      'credit_transactions',
      'app_users',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }

  private async addForeignKey(
    queryRunner: QueryRunner,
    table: string,
    constraint: string,
    column: string,
    references: string,
    onDelete: 'CASCADE' | 'SET NULL',
  ): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = '${constraint}'
        ) THEN
          ALTER TABLE "${table}"
            ADD CONSTRAINT "${constraint}"
            FOREIGN KEY (${column}) REFERENCES "${references}"("id")
            ON DELETE ${onDelete} ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }
}
