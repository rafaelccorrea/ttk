import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `app_users.tokenVersion`: a geração das sessões da conta, que é o que torna
 * um JWT revogável.
 *
 * Sem ela, trocar a senha não derrubava nenhuma sessão aberta — o token é
 * stateless e vale 7 dias (30 no app de desktop), então quem tivesse um token
 * roubado continuava dentro da conta mesmo depois de a vítima trocar a senha.
 * O número entra no token como a claim `tv` e é conferido no guard; incrementar
 * aqui invalida na hora tudo o que já foi emitido para aquele usuário.
 *
 * Nasce em 0 para todo mundo, que é o valor assumido quando a claim não existe:
 * os tokens em circulação no momento do deploy continuam valendo e ninguém é
 * desconectado pela migration.
 */
export class AddUserTokenVersion1786671500000 implements MigrationInterface {
  name = 'AddUserTokenVersion1786671500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "tokenVersion"`,
    );
  }
}
