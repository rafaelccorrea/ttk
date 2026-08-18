import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Uma mensagem do chat, no máximo uma resposta.
 *
 * O motor já evitava a repetição de duas formas — o dedup dentro do lote e a
 * janela de 90 segundos por cluster —, mas as duas vivem na memória de UM
 * processo, e o lote é processado fora da requisição. Dois lotes em voo ao mesmo
 * tempo passam juntos pela checagem e gravam duas respostas para a mesma
 * pergunta: duas linhas no painel do vendedor, no meio da live, e duas linhas de
 * custo no relatório. Com mais de uma instância, nem a memória compartilham.
 *
 * Esta restrição é a única trava que sobrevive à concorrência. Quando ela
 * dispara, o serviço não trata como erro: quem perdeu a corrida devolve a
 * resposta que já estava lá, porque é essa que o vendedor viu.
 */
export class AddLiveReplyUniqueMessage1786668400000
  implements MigrationInterface
{
  name = 'AddLiveReplyUniqueMessage1786668400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Duplicatas anteriores à restrição precisam sair antes, senão a criação do
     * índice falha e a migration trava o deploy. Mantém-se a PRIMEIRA de cada
     * mensagem: é a que foi ao painel e a que o vendedor pode ter usado.
     */
    await queryRunner.query(`
      DELETE FROM "live_replies" a
      USING "live_replies" b
      WHERE a."chatMessageId" = b."chatMessageId"
        AND a."createdAt" > b."createdAt"
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_replies_chatMessageId" ON "live_replies" ("chatMessageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_live_replies_chatMessageId"`,
    );
  }
}
