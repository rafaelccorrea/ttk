import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A resposta CRUA de cada chamada ao fornecedor, como ela chegou.
 *
 * Por que guardar: a requisição é paga e não recupera. Se o parse estiver
 * errado — campo com outro nome, moeda trocada, valor que vinha zerado na
 * origem — descobrir isso depois obrigava a pagar tudo de novo só para ver o
 * JSON. Com o bruto no banco, a investigação é uma consulta, e um parse
 * corrigido pode ser reaplicado sobre o histórico sem gastar cota nenhuma.
 *
 * Também é a única prova de procedência: quando um número da vitrine é
 * questionado, dá para mostrar exatamente o que o fornecedor respondeu, e
 * quando.
 */
@Entity('api_raw_responses')
export class ApiRawResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Caminho chamado, sem a base: `/echotik/product/video/list`. */
  @Index('IDX_api_raw_responses_endpoint')
  @Column()
  endpoint: string;

  /**
   * Parâmetros da query, para reproduzir a chamada exatamente.
   *
   * O default vai SEM o `::jsonb`: ao ler a coluna, o TypeORM tira o cast do
   * que o Postgres reporta (`'{}'::jsonb` vira `'{}'`) mas compara com o texto
   * daqui como está. Com o cast escrito aqui, os dois lados nunca batem e o
   * `schema:log` acusa drift a cada rodada, com o banco correto. Sem ele, o
   * DDL continua idêntico — o Postgres converte o literal sozinho.
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  params: Record<string, unknown>;

  /**
   * Chave do assunto (id do produto, do vídeo, da loja…), quando existe.
   * É por ela que se procura "o que o fornecedor disse sobre ESTE produto".
   */
  @Index('IDX_api_raw_responses_subject')
  @Column({ type: 'varchar', nullable: true })
  subject: string | null;

  @Column({ type: 'int', default: 0 })
  httpStatus: number;

  /** `code` do envelope do fornecedor (0 = sucesso). */
  @Column({ type: 'int', default: 0 })
  code: number;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  /** Quantos itens vieram em `data` — resposta vazia também é informação. */
  @Column({ type: 'int', default: 0 })
  itemCount: number;

  /** O corpo inteiro, como chegou. */
  @Column({ type: 'jsonb', nullable: true })
  payload: unknown;

  /** Contra qual cota a chamada foi debitada. */
  @Column({ type: 'varchar', length: 16, default: 'coleta' })
  purpose: string;

  @Index('IDX_api_raw_responses_createdAt')
  @CreateDateColumn()
  createdAt: Date;
}
