import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Live Copilot, fase 1: a transmissão ao vivo, em modo SOMENTE-PAINEL.
 *
 * A fase 0 montou a base de conhecimento a partir de uma gravação. Aqui entra o
 * loop ao vivo: o app desktop lê o chat da transmissão, o backend agrupa as
 * perguntas repetidas, consulta a base e devolve uma resposta que APARECE NUM
 * PAINEL para o vendedor copiar ou falar. Nada é postado no chat do TikTok
 * nesta fase — injeção de DOM e envio automático ficam para a fase 2. É uma
 * escolha: dá para validar chat, dedup, recuperação, modelo, latência e
 * confiança sem assumir risco de ToS, e o custo de errar é uma resposta ruim na
 * tela do próprio vendedor em vez de uma resposta ruim publicada na live dele.
 *
 * `live_runs` é a transmissão e aponta para a `live_sessions` que serve de base
 * — as duas são separadas porque o mesmo catálogo extraído uma vez alimenta
 * dezenas de lives seguidas.
 */
export class AddLiveRuns1786668200000 implements MigrationInterface {
  name = 'AddLiveRuns1786668200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * O dedup de perguntas compara texto que ninguém digita duas vezes igual:
     * "qnt custa", "quanto é o azul??", "preco?". Igualdade exata agruparia
     * quase nada e o copiloto responderia a mesma dúvida quarenta vezes,
     * queimando modelo e minuto de carteira. `pg_trgm` dá o `similarity()` que
     * sustenta o agrupamento por semelhança.
     */
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "knowledgeSessionId" uuid NOT NULL,
        "tiktokRoomId" character varying,
        "tiktokUsername" character varying,
        "status" character varying NOT NULL DEFAULT 'conectando',
        "mode" character varying NOT NULL DEFAULT 'painel',
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "endedAt" TIMESTAMP WITH TIME ZONE,
        "messagesSeen" integer NOT NULL DEFAULT 0,
        "repliesGenerated" integer NOT NULL DEFAULT 0,
        "escalations" integer NOT NULL DEFAULT 0,
        "minutesCharged" integer NOT NULL DEFAULT 0,
        "lastChargedAt" TIMESTAMP WITH TIME ZONE,
        "errorMessage" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_runs_userId" ON "live_runs" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_chat_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "liveRunId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "externalMessageId" character varying NOT NULL,
        -- Nunca o username: é sha256 do nome com um salt por run (ver a
        -- entidade). O espectador não é cliente nosso e não temos base legal
        -- para guardar quem ele é.
        "authorHash" character varying NOT NULL,
        "text" text NOT NULL,
        "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "isQuestion" boolean NOT NULL DEFAULT false,
        "clusterKey" character varying,
        "status" character varying NOT NULL DEFAULT 'nova',
        "repeatCount" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_chat_messages" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_chat_messages_liveRunId" ON "live_chat_messages" ("liveRunId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_chat_messages_userId" ON "live_chat_messages" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_chat_messages_clusterKey" ON "live_chat_messages" ("clusterKey")`,
    );
    /*
     * O dedup pergunta sempre a mesma coisa: "as mensagens RECENTES DESTA run".
     * Só com o índice de `liveRunId` o Postgres lê a run inteira e ordena à mão —
     * dezenas de milhares de linhas a cada lote de 800ms. O par corta a leitura
     * na janela de tempo e já devolve ordenado.
     */
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_chat_messages_run_receivedAt" ON "live_chat_messages" ("liveRunId", "receivedAt")`,
    );
    /*
     * O par (run, id externo) é a chave de idempotência da reconexão: quando o
     * app desktop perde a conexão no meio da live, ele não sabe o que o backend
     * chegou a gravar e reenvia a janela inteira. Sem este único, a mesma
     * pergunta entraria de novo, seria respondida de novo e cobraria de novo.
     * Escopo por run porque o TikTok não promete id único entre salas.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_chat_messages_external" ON "live_chat_messages" ("liveRunId", "externalMessageId")`,
    );
    /*
     * GIN trigram no texto, e não índice comum: a busca que importa aqui é
     * "existe alguma mensagem PARECIDA com esta?", com `similarity()` e `%`.
     * Um b-tree só serve a igualdade e prefixo, e nenhuma das duas encontra
     * "qnt custa" a partir de "quanto custa" — o dedup cairia para varredura
     * sequencial em cima de dezenas de milhares de linhas por transmissão,
     * dentro do caminho quente que precisa responder em segundos.
     */
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_chat_messages_text_trgm" ON "live_chat_messages" USING gin ("text" gin_trgm_ops)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_replies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "liveRunId" uuid NOT NULL,
        "chatMessageId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "text" text NOT NULL,
        "confidence" numeric(3,2) NOT NULL,
        "model" character varying NOT NULL,
        "decision" character varying NOT NULL,
        "sourceProductIds" uuid array NOT NULL DEFAULT '{}',
        "latencyMs" integer NOT NULL DEFAULT 0,
        "copiedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_replies" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_live_replies_liveRunId" ON "live_replies" ("liveRunId")`,
    );

    // `ADD CONSTRAINT` não aceita `IF NOT EXISTS` no Postgres e o CI roda as
    // migrations duas vezes num banco limpo — daí a checagem em pg_constraint.
    await queryRunner.query(`
      DO $$
      BEGIN
        -- RESTRICT, ao contrário de todo o resto deste arquivo: a base de
        -- conhecimento é material de trabalho, editável e descartável; o
        -- histórico do que foi respondido ao vivo é registro. Apagar um
        -- catálogo velho não pode levar junto a prova do que o copiloto disse
        -- ao público do vendedor.
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_live_runs_session'
        ) THEN
          ALTER TABLE "live_runs"
            ADD CONSTRAINT "FK_live_runs_session"
            FOREIGN KEY ("knowledgeSessionId") REFERENCES "live_sessions"("id")
            ON DELETE RESTRICT;
        END IF;

        -- O chat e as respostas não têm vida fora da transmissão que os gerou.
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_live_chat_messages_run'
        ) THEN
          ALTER TABLE "live_chat_messages"
            ADD CONSTRAINT "FK_live_chat_messages_run"
            FOREIGN KEY ("liveRunId") REFERENCES "live_runs"("id")
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_live_replies_run'
        ) THEN
          ALTER TABLE "live_replies"
            ADD CONSTRAINT "FK_live_replies_run"
            FOREIGN KEY ("liveRunId") REFERENCES "live_runs"("id")
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_live_replies_message'
        ) THEN
          ALTER TABLE "live_replies"
            ADD CONSTRAINT "FK_live_replies_message"
            FOREIGN KEY ("chatMessageId") REFERENCES "live_chat_messages"("id")
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // RLS deny-all, sem policy: a API fala com o banco como owner e ignora RLS,
    // então nada muda para a aplicação. O que muda é o resto do mundo — a
    // `anon key` do Supabase é pública e vai no bundle do front (ver
    // HardenRlsDefaults). Aqui exposto seria o chat inteiro da live.
    for (const tabela of ['live_runs', 'live_chat_messages', 'live_replies']) {
      await queryRunner.query(
        `ALTER TABLE "${tabela}" ENABLE ROW LEVEL SECURITY`,
      );
    }
  }

  /**
   * Ordem inversa das dependências. A extensão `pg_trgm` fica: é global do
   * banco, outras coisas podem passar a usá-la, e derrubá-la no rollback de uma
   * migration de tabela seria um efeito colateral fora do escopo.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "live_replies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "live_chat_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "live_runs"`);
  }
}
