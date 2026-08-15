import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fábrica de criativos: produto do vendedor, persona, campanha e cenas.
 *
 * Quatro tabelas novas e nenhuma alteração nas existentes — `generated_media`
 * continua igual e passa a ser referenciada pela cena que a originou.
 *
 * Sobre as chaves estrangeiras: cena → campanha é CASCADE, porque cena órfã
 * não significa nada. Já campanha → produto/persona é RESTRICT: apagar a
 * persona de uma campanha renderizada apagaria o único registro de com qual
 * rosto aquele vídeo foi feito.
 */
export class AddCampaigns1786666300000 implements MigrationInterface {
  name = 'AddCampaigns1786666300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_products" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "priceBrl" numeric(12,2),
        "benefit" text,
        "problemSolved" text,
        "images" text array NOT NULL DEFAULT '{}',
        "sourceProductId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_products" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_products_userId" ON "user_products" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "personas" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "label" character varying NOT NULL,
        "attrs" jsonb NOT NULL,
        "promptFragment" text NOT NULL,
        "status" character varying NOT NULL DEFAULT 'gerando',
        "seedMediaId" uuid,
        "seedImageUrl" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_personas" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_personas_userId" ON "personas" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "campaigns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "userProductId" uuid NOT NULL,
        "personaId" uuid NOT NULL,
        "title" character varying NOT NULL,
        "durationSeconds" integer NOT NULL DEFAULT 15,
        "status" character varying NOT NULL DEFAULT 'rascunho',
        "script" text,
        "model" character varying,
        "creditsSpent" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaigns" PRIMARY KEY ("id"),
        CONSTRAINT "FK_campaigns_product" FOREIGN KEY ("userProductId")
          REFERENCES "user_products"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_campaigns_persona" FOREIGN KEY ("personaId")
          REFERENCES "personas"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_campaigns_userId" ON "campaigns" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "campaign_scenes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "campaignId" uuid NOT NULL,
        "ordem" integer NOT NULL,
        "fala" text NOT NULL,
        "acaoVisual" text NOT NULL,
        "promptFinal" text,
        "status" character varying NOT NULL DEFAULT 'pendente',
        "generatedMediaId" uuid,
        "outputUrl" text,
        "error" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaign_scenes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_campaign_scenes_campaign" FOREIGN KEY ("campaignId")
          REFERENCES "campaigns"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_campaign_scenes_campaignId" ON "campaign_scenes" ("campaignId")`,
    );
    // A tela lista sempre na ordem do roteiro.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_campaign_scenes_ordem" ON "campaign_scenes" ("campaignId", "ordem")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_scenes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaigns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "personas"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_products"`);
  }
}
