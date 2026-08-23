import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * O app tentou a cascata inteira de seletores e não achou o campo de comentário.
 *
 * É o sistema de alarme do envio automático. O TikTok reescreve o HTML da live
 * sem avisar, e quando isso acontece o recurso morre para todo mundo ao mesmo
 * tempo — mas do lado do usuário, em silêncio. Sem esta tabela, a primeira
 * notícia viria pelo suporte, dias depois; com ela, um punhado de linhas
 * chegando na mesma hora é o gatilho para publicar seletor novo (que é deploy
 * nosso, não release do app — ver `LiveConfigService`).
 *
 * `selectorsVersion` é o que dá sentido ao registro: sem ela não daria para
 * distinguir "este usuário ainda está com a cascata velha em cache" de "a
 * cascata nova também não serve", que pedem reações opostas.
 *
 * O `htmlSample` é o esqueleto do container, JÁ SANEADO NO SERVIDOR — sem texto
 * de comentário, de ninguém. Ver `sanitizarHtml`: o chat de uma live é escrito
 * por terceiros que nunca foram clientes nossos, e guardar o que eles digitaram
 * numa tabela de diagnóstico não tem base legal nenhuma. Para escrever um
 * seletor novo basta a estrutura de tags e atributos.
 */
@Entity('live_selector_failures')
export class LiveSelectorFailure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_live_selector_failures_userId')
  @Column('uuid')
  userId: string;

  /**
   * A run em que aconteceu, quando o app sabe qual é.
   *
   * Nulo é caso legítimo e comum: a cascata falha justamente na hora de armar o
   * envio, que pode ser antes de a run existir. Sem chave estrangeira de
   * propósito — o diagnóstico precisa sobreviver ao expurgo da run, e uma
   * telemetria que recusa a própria gravação por causa de um id órfão é uma
   * telemetria que some quando mais se precisa dela.
   */
  @Column({ type: 'uuid', nullable: true })
  liveRunId: string | null;

  /** A versão da cascata que o app estava usando quando falhou. */
  @Column('int')
  selectorsVersion: number;

  /** Esqueleto de tags, truncado em ~4000 caracteres. Nunca texto de chat. */
  @Column({ type: 'text' })
  htmlSample: string;

  /** Identifica a versão do Electron/Chromium — o DOM varia entre elas. */
  @Column({ type: 'varchar', nullable: true })
  userAgent: string | null;

  /**
   * QUAL cascata falhou (`campo`, `botao_enviar`, `aviso`, `botao_encerrar`,
   * `painel_produtos`, `botao_pin`). Nulo nos relatos antigos, de quando só
   * existia a cascata do envio.
   */
  @Column({ type: 'varchar', nullable: true })
  context: string | null;

  @Index('IDX_live_selector_failures_createdAt')
  @CreateDateColumn()
  createdAt: Date;
}
