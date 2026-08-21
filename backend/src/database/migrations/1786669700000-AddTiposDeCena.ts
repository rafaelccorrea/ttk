import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O formato da cena vira escolha explícita, não mais dedução binária.
 *
 *  - `campaign_scenes.tipo` ganha novos valores: o antigo `produto` vira
 *    `produto_close`, e a cena de apresentador com `seguraProduto=true` vira
 *    `apresentador_produto`; nascem `mao_produto` e `unboxing` (sem pessoa).
 *  - `campaign_scenes.modoAudio`: como a fala vira áudio — `fala` (lip-sync
 *    do próprio modelo, só com apresentador), `narracao` (TTS em off) ou
 *    `sem_fala`. Backfill espelha o comportamento atual: apresentador fala,
 *    cena sem pessoa é narrada.
 *  - `campaigns.estilo`: com apresentador (`ugc`), só produto
 *    (`sem_apresentador`) ou a IA decide (`misto` — o comportamento antigo,
 *    default das campanhas existentes).
 *  - `campaigns.vozNarrador`: voz escolhida quando o estilo dispensa persona.
 */
export class AddTiposDeCena1786669700000 implements MigrationInterface {
  name = 'AddTiposDeCena1786669700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaign_scenes" ADD COLUMN IF NOT EXISTS "modoAudio" character varying NOT NULL DEFAULT 'fala'`,
    );
    await queryRunner.query(
      `UPDATE "campaign_scenes" SET "tipo" = 'apresentador_produto' WHERE "tipo" = 'apresentador' AND "seguraProduto" = true`,
    );
    await queryRunner.query(
      `UPDATE "campaign_scenes" SET "tipo" = 'produto_close', "modoAudio" = 'narracao' WHERE "tipo" = 'produto'`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "estilo" character varying NOT NULL DEFAULT 'misto'`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "vozNarrador" text`,
    );
    // Campanha sem apresentador não tem persona.
    await queryRunner.query(
      `ALTER TABLE "campaigns" ALTER COLUMN "personaId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Campanhas sem persona precisam sumir antes do NOT NULL voltar.
    await queryRunner.query(`DELETE FROM "campaigns" WHERE "personaId" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "campaigns" ALTER COLUMN "personaId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "vozNarrador"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "estilo"`,
    );
    // `mao_produto` e `unboxing` também voltam a ser `produto`: no esquema
    // antigo toda cena sem pessoa era esse valor.
    await queryRunner.query(
      `UPDATE "campaign_scenes" SET "tipo" = 'produto' WHERE "tipo" IN ('produto_close', 'mao_produto', 'unboxing')`,
    );
    await queryRunner.query(
      `UPDATE "campaign_scenes" SET "tipo" = 'apresentador', "seguraProduto" = true WHERE "tipo" = 'apresentador_produto'`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_scenes" DROP COLUMN IF EXISTS "modoAudio"`,
    );
  }
}
