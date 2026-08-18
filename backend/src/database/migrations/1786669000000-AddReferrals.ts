import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Programa de indicação: quem indicou e se a recompensa já saiu.
 *
 * `referredBy` é gravado no CADASTRO (o vínculo nasce com a conta) e a
 * recompensa só é paga no PAGAMENTO — por isso as duas colunas, e não uma. Sem
 * `referralRewardedAt` não haveria como distinguir "indicado que ainda não
 * assinou" de "indicado que já rendeu os créditos", e toda renovação mensal do
 * mesmo assinante pagaria o bônus de novo.
 *
 * A FK é `ON DELETE SET NULL`: apagar quem indicou não pode apagar em cascata
 * as contas que ele trouxe.
 */
export class AddReferrals1786669000000 implements MigrationInterface {
  name = 'AddReferrals1786669000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "referredBy" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "referralRewardedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_users_referredBy" ON "app_users" ("referredBy")`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "app_users"
          ADD CONSTRAINT "FK_app_users_referredBy"
          FOREIGN KEY ("referredBy") REFERENCES "app_users"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP CONSTRAINT IF EXISTS "FK_app_users_referredBy"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_users_referredBy"`);
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "referralRewardedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "referredBy"`,
    );
  }
}
