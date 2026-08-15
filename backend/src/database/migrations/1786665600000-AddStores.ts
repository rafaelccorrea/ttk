import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabelas do módulo `stores` — loja do usuário e os dados importados dos
 * relatórios do Seller Center (produtos, pedidos, itens, repasses e histórico
 * de importações).
 *
 * O DDL é idempotente de propósito: os ambientes que rodaram com
 * `synchronize: true` já possuem essas tabelas, e a migration precisa poder
 * ser aplicada neles sem quebrar. Em banco limpo o resultado é idêntico ao que
 * o TypeORM geraria.
 */
export class AddStores1786665600000 implements MigrationInterface {
  name = 'AddStores1786665600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stores" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "name" character varying NOT NULL,
        "marketplace" character varying NOT NULL DEFAULT 'tiktok_shop',
        "source" character varying NOT NULL DEFAULT 'csv',
        "externalShopId" character varying,
        "currency" character varying NOT NULL DEFAULT 'BRL',
        "dateOrder" character varying NOT NULL DEFAULT 'dmy',
        "commissionPct" numeric(5,2) NOT NULL DEFAULT '0',
        "taxPct" numeric(5,2) NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_7aa6e7d71fa7acdd7ca43d7c9cb" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_f36d697e265ed99b80cae6984c" ON "stores" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "store_products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "storeId" uuid NOT NULL,
        "sku" character varying NOT NULL,
        "externalId" character varying,
        "title" character varying NOT NULL,
        "category" character varying,
        "price" numeric(12,2),
        "cost" numeric(12,2),
        "stock" integer,
        "stockAlert" integer,
        "status" character varying,
        "imageUrl" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uq_store_product_sku" UNIQUE ("storeId", "sku"),
        CONSTRAINT "PK_2b42017b5d7c8bc0a2320a7295c" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_d4c7d45afdd5e17611ee80cc77" ON "store_products" ("storeId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "store_orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "storeId" uuid NOT NULL,
        "externalId" character varying NOT NULL,
        "placedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" character varying NOT NULL,
        "stage" character varying NOT NULL,
        "shipBy" TIMESTAMP WITH TIME ZONE,
        "shippedAt" TIMESTAMP WITH TIME ZONE,
        "shippingProvider" character varying,
        "trackingCode" character varying,
        "grossAmount" numeric(12,2) NOT NULL DEFAULT '0',
        "shippingFee" numeric(12,2) NOT NULL DEFAULT '0',
        "discount" numeric(12,2) NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uq_store_order_external" UNIQUE ("storeId", "externalId"),
        CONSTRAINT "PK_933466221cd1655422e141de423" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_c025db0455a30e96c83c82f0a5" ON "store_orders" ("storeId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_318f423aea7c9f7bf315e067b9" ON "store_orders" ("placedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_21f665880b926395d95dcd6836" ON "store_orders" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "store_order_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "orderId" uuid NOT NULL,
        "sku" character varying NOT NULL,
        "title" character varying,
        "quantity" integer NOT NULL DEFAULT '1',
        "unitPrice" numeric(12,2) NOT NULL DEFAULT '0',
        "discount" numeric(12,2) NOT NULL DEFAULT '0',
        "subtotal" numeric(12,2) NOT NULL DEFAULT '0',
        CONSTRAINT "PK_f32650fc0c0127feb430dd489ce" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ecf46bc769f4dde71ed7fa210c" ON "store_order_items" ("orderId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_73306f83c2464c744a80956b8d" ON "store_order_items" ("sku")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "store_settlements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "storeId" uuid NOT NULL,
        "externalOrderId" character varying NOT NULL,
        "settledAt" TIMESTAMP WITH TIME ZONE,
        "grossAmount" numeric(12,2) NOT NULL DEFAULT '0',
        "platformFee" numeric(12,2) NOT NULL DEFAULT '0',
        "commissionFee" numeric(12,2) NOT NULL DEFAULT '0',
        "affiliateFee" numeric(12,2) NOT NULL DEFAULT '0',
        "shippingFee" numeric(12,2) NOT NULL DEFAULT '0',
        "otherFees" numeric(12,2) NOT NULL DEFAULT '0',
        "netAmount" numeric(12,2) NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uq_store_settlement_order" UNIQUE ("storeId", "externalOrderId"),
        CONSTRAINT "PK_293b2bde4f7ade82708a83833a9" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_6f1e4903bf06b69248ce1854c2" ON "store_settlements" ("storeId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_e65a0fb969fe8feea6afd599aa" ON "store_settlements" ("externalOrderId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "store_imports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "storeId" uuid NOT NULL,
        "dataset" character varying NOT NULL,
        "source" character varying NOT NULL DEFAULT 'csv',
        "fileName" character varying,
        "rowsRead" integer NOT NULL DEFAULT '0',
        "created" integer NOT NULL DEFAULT '0',
        "updated" integer NOT NULL DEFAULT '0',
        "skipped" integer NOT NULL DEFAULT '0',
        "issues" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_f2e48fb7153207b1aa95a9a535d" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_568483b1690bb2ce99b51f1ecb" ON "store_imports" ("storeId")`,
    );

    // Postgres não tem "ADD CONSTRAINT IF NOT EXISTS": checamos no catálogo.
    await this.addForeignKey(
      queryRunner,
      'store_products',
      'FK_d4c7d45afdd5e17611ee80cc774',
      '"storeId"',
      'stores',
    );
    await this.addForeignKey(
      queryRunner,
      'store_orders',
      'FK_c025db0455a30e96c83c82f0a5d',
      '"storeId"',
      'stores',
    );
    await this.addForeignKey(
      queryRunner,
      'store_order_items',
      'FK_ecf46bc769f4dde71ed7fa210cb',
      '"orderId"',
      'store_orders',
    );
    await this.addForeignKey(
      queryRunner,
      'store_settlements',
      'FK_6f1e4903bf06b69248ce1854c22',
      '"storeId"',
      'stores',
    );
    await this.addForeignKey(
      queryRunner,
      'store_imports',
      'FK_568483b1690bb2ce99b51f1ecbc',
      '"storeId"',
      'stores',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A ordem respeita as dependências de chave estrangeira.
    await queryRunner.query(`DROP TABLE IF EXISTS "store_imports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "store_settlements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "store_order_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "store_orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "store_products"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stores"`);
  }

  private async addForeignKey(
    queryRunner: QueryRunner,
    table: string,
    constraint: string,
    column: string,
    references: string,
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
            ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }
}
