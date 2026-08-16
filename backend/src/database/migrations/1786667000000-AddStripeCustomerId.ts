import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Liga a conta ao cliente do Stripe.
 *
 * Sem esta coluna a assinatura só tinha dono num sentido: nós sabíamos o
 * customer a partir do checkout, mas os webhooks de ciclo de vida
 * (`customer.subscription.deleted`, `invoice.payment_failed`) chegam
 * identificados pelo customer — e não pelo nosso userId. Quem cancelasse
 * ficaria no plano pago para sempre, porque não havia como saber quem rebaixar.
 * É também o que permite abrir o Billing Portal para o cliente cancelar e
 * trocar cartão sem passar pelo suporte.
 */
export class AddStripeCustomerId1786667000000 implements MigrationInterface {
  name = 'AddStripeCustomerId1786667000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "stripeCustomerId" text`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_users_stripeCustomerId" ON "app_users" ("stripeCustomerId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_app_users_stripeCustomerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "stripeCustomerId"`,
    );
  }
}
