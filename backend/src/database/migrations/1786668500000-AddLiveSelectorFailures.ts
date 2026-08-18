import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O alarme do envio automático: quando a cascata de seletores falha inteira.
 *
 * A configuração de envio (seletores, limites, kill switch) é servida pelo
 * backend justamente porque o TikTok reescreve o HTML da live sem avisar — e
 * quando isso acontece, o recurso morre para a frota toda no mesmo instante.
 * Servir do backend torna a correção um deploy nosso em vez de um release do
 * app que o vendedor ainda precisa aceitar instalar. Só que corrigir rápido não
 * adianta se a gente demora dias para SABER: do lado do usuário a quebra é
 * silenciosa, o comentário simplesmente não sai.
 *
 * `live_selector_failures` é esse aviso. Um punhado de linhas chegando na mesma
 * hora, todas com a mesma `selectorsVersion`, é o gatilho para publicar seletor
 * novo.
 *
 * O `htmlSample` guarda o ESQUELETO do container — tags e atributos —, nunca o
 * conteúdo. O saneamento acontece no servidor, antes de gravar e antes de
 * logar: o chat de uma live é escrito por espectadores que nunca foram clientes
 * nossos e que despejam ali telefone, CPF e endereço (é o mesmo motivo da
 * `LISTA_NEGRA` do motor de resposta). Não há base legal para guardar isso numa
 * tabela de diagnóstico, e para escrever um seletor novo o texto não serve para
 * nada — só a estrutura serve.
 *
 * As duas colunas em `app_users` são o aceite do termo de envio automático. Vêm
 * em par de propósito: a data diz quando, a versão diz O QUE ele leu. Um
 * booleano não provaria nada no dia em que a conta de alguém for suspensa, e
 * uma redação nova não pode herdar em silêncio o consentimento dado à antiga.
 */
export class AddLiveSelectorFailures1786668500000 implements MigrationInterface {
  name = 'AddLiveSelectorFailures1786668500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_selector_failures" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        -- Sem chave estrangeira para "live_runs", e não por esquecimento: a
        -- cascata falha na hora de armar o envio, às vezes antes de a run
        -- existir, e o diagnóstico precisa sobreviver ao expurgo dela. Uma
        -- telemetria que recusa a própria gravação por causa de um id órfão é
        -- uma telemetria que some justamente quando mais se precisa dela.
        "liveRunId" uuid,
        "selectorsVersion" integer NOT NULL,
        -- Já saneado no servidor: só tags e atributos, no máximo ~4000 chars.
        "htmlSample" text NOT NULL,
        "userAgent" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_selector_failures" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_selector_failures_userId" ON "live_selector_failures" ("userId")`,
    );
    /*
     * A pergunta que se faz a esta tabela é sempre "o que chegou nas últimas
     * horas?" — é assim que se distingue uma quebra global de um caso isolado
     * de um usuário com extensão de navegador estranha.
     */
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_selector_failures_createdAt" ON "live_selector_failures" ("createdAt")`,
    );

    // RLS deny-all, sem policy: a API fala com o banco como owner e ignora RLS.
    // O que muda é o resto do mundo — a `anon key` do Supabase é pública e vai
    // no bundle do front. Exposto aqui seria o mapa do DOM que a gente usa.
    await queryRunner.query(
      `ALTER TABLE "live_selector_failures" ENABLE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(`
      ALTER TABLE "app_users"
        ADD COLUMN IF NOT EXISTS "liveAutoAcceptedAt" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "liveAutoAcceptedVersion" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * `liveAutoAcceptedAt` NÃO cai aqui: ela é criada também pela migration do
     * envio automático, que roda depois desta. Derrubá-la no rollback desta
     * apagaria uma coluna que a outra considera sua — e, pior, apagaria aceites
     * registrados. A versão, que só existe por causa desta migration, cai.
     */
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "liveAutoAcceptedVersion"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "live_selector_failures"`);
  }
}
