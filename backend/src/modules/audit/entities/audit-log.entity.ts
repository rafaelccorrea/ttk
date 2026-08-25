import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Trilha de auditoria global: uma linha por ação de qualquer usuário (login,
 * geração, exclusão, cobrança, ação de admin...). Escrita pelo
 * `AuditInterceptor` em toda rota que muda estado e por chamadas explícitas
 * do `AuditService`. Só cresce — nunca é editada nem apagada pelo app.
 */
@Entity('audit_logs')
@Index(['userId', 'createdAt'])
@Index(['acao', 'createdAt'])
@Index(['categoria', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Quem fez. Nulo em ações anônimas (login falho, webhook). */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /** E-mail no momento do evento — sobrevive a troca/exclusão da conta. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  userEmail: string | null;

  /** Primeiro segmento da rota: auth, campaigns, studio, live, billing, admin... */
  @Column({ type: 'varchar', length: 40 })
  categoria: string;

  /** Nome estável da ação, ex. `campaigns.render_all`, `auth.login`. */
  @Column({ type: 'varchar', length: 120 })
  acao: string;

  /** Verbo HTTP. */
  @Column({ type: 'varchar', length: 8 })
  metodo: string;

  /** Caminho real chamado (com ids), sem query string. */
  @Column({ type: 'varchar', length: 500 })
  rota: string;

  /** Id do recurso alvo (primeiro id na rota), quando há. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  alvoId: string | null;

  @Column({ type: 'int' })
  statusCode: number;

  /** `ok` | `erro` — erro cobre 4xx/5xx, inclusive login com senha errada. */
  @Column({ type: 'varchar', length: 8 })
  resultado: 'ok' | 'erro';

  /** Mensagem do erro, quando houve. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  erro: string | null;

  /** Corpo/query da requisição sanitizados (senhas/tokens removidos, truncado). */
  @Column({ type: 'jsonb', nullable: true })
  detalhe: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  userAgent: string | null;

  @Column({ type: 'int' })
  duracaoMs: number;

  /** true quando o ator é administrador (ações da equipe). */
  @Column({ type: 'boolean', default: false })
  admin: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  @Index()
  createdAt: Date;
}
