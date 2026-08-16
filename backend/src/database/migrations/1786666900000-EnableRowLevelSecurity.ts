import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fecha o acesso direto ao banco pelas chaves públicas do Supabase.
 *
 * O PikPok não usa PostgREST: todo acesso a dado passa pela API NestJS, que
 * conecta com o dono das tabelas (DATABASE_URL) e por isso ignora RLS. Só que
 * o projeto Supabase expõe a mesma base via PostgREST com a `anon key` — que é
 * pública por definição, ela vai no bundle do front. Com as tabelas
 * "Unrestricted" (RLS desligado, como estavam), qualquer pessoa com essa chave
 * lia o catálogo inteiro e, pior, dava `PATCH /app_users` para se promover a
 * `business` com créditos infinitos. Isto é, o paywall era contornável por uma
 * requisição HTTP.
 *
 * A correção tem duas camadas, porque uma só não basta:
 *  1. REVOKE em `anon`/`authenticated` — tira o privilégio na tabela;
 *  2. ENABLE ROW LEVEL SECURITY sem nenhuma policy — deny-all mesmo que um
 *     GRANT volte no futuro (o Supabase concede privilégios em tabelas novas
 *     por default privileges, então a camada 1 sozinha expira).
 *
 * O dono das tabelas continua passando: RLS não se aplica ao owner, e não
 * usamos FORCE ROW LEVEL SECURITY justamente para preservar isso. Se um dia a
 * API passar a conectar com um role comum, será preciso criar policies ou um
 * BYPASSRLS explícito.
 *
 * O bloco varre `pg_tables` em vez de listar nomes: tabela nova nasce
 * desprotegida, e uma lista fixa envelheceria em silêncio. As roles do Supabase
 * são checadas antes de cada REVOKE porque em Postgres local e no CI elas não
 * existem.
 */
export class EnableRowLevelSecurity1786666900000 implements MigrationInterface {
  name = 'EnableRowLevelSecurity1786666900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        t record;
        r text;
      BEGIN
        FOR t IN
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename <> 'migrations'
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
   * Reabrir é deliberadamente parcial: o down desliga o RLS para destravar um
   * rollback, mas NÃO devolve os GRANTs a `anon`/`authenticated`. Reconceder
   * acesso público de escrita ao banco nunca é o que se quer num rollback
   * automático — se for mesmo necessário, que seja um GRANT manual e
   * consciente.
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
