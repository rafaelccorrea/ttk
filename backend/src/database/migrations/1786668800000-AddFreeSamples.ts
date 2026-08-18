import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A amostra da conta gratuita (ver `docs/CONTA-FREE.md`).
 *
 * Uma linha por janela de 7 dias, com os ids que TODA conta gratuita enxerga
 * naquela janela. É a tabela que sustenta a promessa central do modo amostra:
 * o conjunto é global e congelado, então dar F5 devolve exatamente os mesmos
 * itens e uma segunda conta não revela nada novo.
 *
 * **Por que em tabela e não em cache de memória.** O congelamento é a promessa,
 * e uma promessa que o restart quebra não é promessa: um deploy na quarta-feira
 * trocaria a amostra no meio da semana, para todo mundo, sem que ninguém
 * tivesse decidido isso.
 *
 * **Por que `slot` e não um `generatedAt` solto.** `slot` é o número da janela
 * de 7 dias desde a época Unix, calculado na aplicação. Ele dá duas coisas de
 * uma vez: a rotação fica alinhada globalmente (não depende de quem foi o
 * primeiro visitante a acordar o snapshot) e o UNIQUE do banco vira a garantia
 * de que duas requisições simultâneas numa janela vazia não criam dois
 * snapshots concorrentes — a segunda perde a corrida e lê o que a primeira
 * gravou. Sem isso, dois usuários veriam amostras diferentes na mesma semana,
 * que é exatamente o bug que este desenho existe para impedir.
 *
 * Os ids ficam em `jsonb` e sem FK de propósito: um produto pode sair do
 * catálogo no meio da semana, e isso deve encolher a amostra — nunca fazer a
 * limpeza do catálogo falhar por causa de uma linha de vitrine.
 */
export class AddFreeSamples1786668800000 implements MigrationInterface {
  name = 'AddFreeSamples1786668800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "free_samples" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slot" integer NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "productIds" jsonb NOT NULL DEFAULT '[]',
        "videoIds" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_free_samples" PRIMARY KEY ("id")
      )
    `);

    // UNIQUE porque é regra, não desempenho: uma janela, uma amostra.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_free_samples_slot" ON "free_samples" ("slot")`,
    );

    await queryRunner.query(
      `ALTER TABLE "free_samples" ENABLE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_free_samples_slot"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "free_samples"`);
  }
}
