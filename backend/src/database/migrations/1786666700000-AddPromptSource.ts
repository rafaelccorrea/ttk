import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dá procedência e data às linhas do Cofre de Prompts.
 *
 * Até aqui todo prompt vinha do seed e nunca mudava. Com a atualização
 * periódica, passa a existir uma segunda origem — e o `source` é o que garante
 * que a rotina automática jamais apague o conteúdo curado.
 *
 * O default 'seed' classifica corretamente tudo o que já está gravado.
 */
export class AddPromptSource1786666700000 implements MigrationInterface {
  name = 'AddPromptSource1786666700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompt_templates" ADD COLUMN IF NOT EXISTS "source" character varying NOT NULL DEFAULT 'seed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompt_templates" ADD COLUMN IF NOT EXISTS "sourceKey" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompt_templates" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_prompt_templates_source" ON "prompt_templates" ("source")`,
    );
    // Único para que a rodada semanal ATUALIZE o card existente em vez de
    // empilhar duplicatas. Nulo em tudo que veio do seed — e no Postgres cada
    // NULL é distinto, então o índice único não atrapalha os curados.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_prompt_templates_source_key" ON "prompt_templates" ("sourceKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_prompt_templates_source_key"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_prompt_templates_source"`);
    await queryRunner.query(`ALTER TABLE "prompt_templates" DROP COLUMN IF EXISTS "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "prompt_templates" DROP COLUMN IF EXISTS "sourceKey"`);
    await queryRunner.query(`ALTER TABLE "prompt_templates" DROP COLUMN IF EXISTS "source"`);
  }
}
