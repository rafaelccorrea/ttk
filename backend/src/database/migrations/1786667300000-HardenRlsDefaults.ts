import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fecha o vazamento que a `EnableRowLevelSecurity` deixou em aberto.
 *
 * Aquela migration protegeu as tabelas que existiam no dia em que rodou — e só.
 * Tabela criada depois nasce com RLS desligado e, pior, com os GRANTs que o
 * Supabase concede a `anon`/`authenticated` por default privileges. Foi o que
 * aconteceu com `api_raw_responses`: em produção ela estava legível, gravável e
 * TRUNCÁVEL por qualquer um com a `anon key` — que é pública, vai no bundle do
 * front. A tabela guarda a resposta crua do fornecedor de dados, ou seja,
 * exatamente o insumo que pagamos para ter.
 *
 * Então aqui não repetimos o remendo: atacamos a causa.
 *
 *  1. `ALTER DEFAULT PRIVILEGES ... REVOKE` faz com que TODA tabela futura
 *     criada por este role (é ele quem roda as migrations) já nasça sem
 *     privilégio nenhum para as roles públicas. Sem isso, o próximo
 *     `CREATE TABLE` reabre o buraco em silêncio.
 *  2. A varredura de RLS/REVOKE roda de novo para pegar o que entrou desde
 *     então, agora incluindo a própria tabela `migrations` — que estava fora da
 *     primeira passada e podia ser apagada por `anon`, o que permitiria
 *     reexecutar migrations à revelia.
 *
 * Continua valendo a regra para quem criar tabela nova: ligue o RLS na mesma
 * migration. O passo 1 tira o acesso, mas RLS não tem "default" em Postgres —
 * é sempre por tabela.
 */
export class HardenRlsDefaults1786667300000 implements MigrationInterface {
  name = 'HardenRlsDefaults1786667300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        t record;
        r text;
      BEGIN
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            -- Tabelas futuras: nascem sem privilégio para as roles públicas.
            EXECUTE format(
              'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r
            );
            EXECUTE format(
              'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r
            );
          END IF;
        END LOOP;

        -- Tabelas de agora: inclui as criadas depois da primeira varredura.
        FOR t IN
          SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        LOOP
          FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
              EXECUTE format(
                'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', t.tablename, r
              );
            END IF;
          END LOOP;
          EXECUTE format(
            'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename
          );
        END LOOP;
      END $$;
    `);
  }

  /**
   * Como na migration anterior, o rollback só desliga o RLS. Devolver GRANT
   * público ao banco jamais deve ser efeito colateral de um `migration:revert`.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        t record;
      BEGIN
        FOR t IN
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename <> 'migrations'
        LOOP
          EXECUTE format(
            'ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.tablename
          );
        END LOOP;
      END $$;
    `);
  }
}
