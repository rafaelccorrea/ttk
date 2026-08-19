import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Detalhes livres do produto, para a IA responder melhor.
 *
 * A base tinha só os campos estruturados (preço, variações, frete, promoção,
 * apelidos) — e o chat da live pergunta garantia, material, medida, voltagem,
 * o que vem na caixa, se serve para presente. Nada disso tinha onde morar, e a
 * resposta certa escalava para o vendedor digitar ao vivo o que ele poderia
 * ter cadastrado antes. `details` é o texto corrido que o vendedor escreve uma
 * vez e a IA passa a usar em toda live com esta base.
 */
export class AddLiveProductDetails1786669600000 implements MigrationInterface {
  name = 'AddLiveProductDetails1786669600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_products" ADD COLUMN IF NOT EXISTS "details" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_products" DROP COLUMN IF EXISTS "details"`,
    );
  }
}
