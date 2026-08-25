import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  ILike,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export type AuditEntrada = Omit<AuditLog, 'id' | 'createdAt'>;

export interface AuditFiltro {
  busca?: string;
  userId?: string;
  categoria?: string;
  acao?: string;
  resultado?: 'ok' | 'erro';
  admin?: boolean;
  desde?: string;
  ate?: string;
  page?: number;
  limit?: number;
}

/** Chaves que nunca vão para o `detalhe`, em qualquer profundidade. */
const CHAVES_SENSIVEIS =
  /pass|senha|token|secret|credential|authorization|cookie|apikey|api_key/i;
const TAMANHO_MAX_DETALHE = 4000;

export function sanitizarDetalhe(valor: unknown, profundidade = 0): unknown {
  if (valor == null || profundidade > 4) return valor ?? null;
  if (Array.isArray(valor)) {
    return valor.slice(0, 50).map((v) => sanitizarDetalhe(v, profundidade + 1));
  }
  if (typeof valor === 'object') {
    if (Buffer.isBuffer(valor)) return `[buffer ${valor.length}b]`;
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      saida[k] = CHAVES_SENSIVEIS.test(k)
        ? '[oculto]'
        : sanitizarDetalhe(v, profundidade + 1);
    }
    return saida;
  }
  if (typeof valor === 'string' && valor.length > 500) {
    return `${valor.slice(0, 500)}... (${valor.length} chars)`;
  }
  return valor;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Fire-and-forget: auditoria nunca pode derrubar nem atrasar a requisição
   * que está sendo auditada. Falha só vai para o log do servidor.
   */
  registrar(entrada: AuditEntrada): void {
    let detalhe = entrada.detalhe;
    if (detalhe && JSON.stringify(detalhe).length > TAMANHO_MAX_DETALHE) {
      detalhe = { truncado: true, chaves: Object.keys(detalhe) };
    }
    this.repo
      .insert({ ...entrada, detalhe } as never)
      .catch((e) =>
        this.logger.warn(
          `Falha ao gravar auditoria ${entrada.acao}: ${e?.message}`,
        ),
      );
  }

  /**
   * Evento de negócio registrado à mão por um serviço (fora do ciclo HTTP —
   * jobs, webhooks, cron). Preenche o que não faz sentido nesse contexto.
   */
  evento(params: {
    userId?: string | null;
    userEmail?: string | null;
    categoria: string;
    acao: string;
    alvoId?: string | null;
    resultado?: 'ok' | 'erro';
    erro?: string | null;
    detalhe?: Record<string, unknown> | null;
  }): void {
    this.registrar({
      userId: params.userId ?? null,
      userEmail: params.userEmail ?? null,
      categoria: params.categoria,
      acao: params.acao,
      metodo: 'SYS',
      rota: `sys:${params.acao}`,
      alvoId: params.alvoId ?? null,
      statusCode: params.resultado === 'erro' ? 500 : 200,
      resultado: params.resultado ?? 'ok',
      erro: params.erro ?? null,
      detalhe: params.detalhe
        ? (sanitizarDetalhe(params.detalhe) as Record<string, unknown>)
        : null,
      ip: null,
      userAgent: null,
      duracaoMs: 0,
      admin: false,
    });
  }

  async listar(f: AuditFiltro) {
    const page = Math.max(1, f.page ?? 1);
    const limit = Math.min(200, Math.max(1, f.limit ?? 50));
    const where: FindOptionsWhere<AuditLog> = {};
    if (f.userId) where.userId = f.userId;
    if (f.categoria) where.categoria = f.categoria;
    if (f.acao) where.acao = f.acao;
    if (f.resultado) where.resultado = f.resultado;
    if (f.admin !== undefined) where.admin = f.admin;
    if (f.desde && f.ate) {
      where.createdAt = Between(new Date(f.desde), new Date(f.ate));
    } else if (f.desde) {
      where.createdAt = MoreThanOrEqual(new Date(f.desde));
    } else if (f.ate) {
      where.createdAt = LessThanOrEqual(new Date(f.ate));
    }

    // Busca livre: e-mail, rota (inclui ids de recurso) ou nome da ação.
    const busca = f.busca?.trim();
    const wheres: FindOptionsWhere<AuditLog>[] = busca
      ? [
          { ...where, userEmail: ILike(`%${busca}%`) },
          { ...where, rota: ILike(`%${busca}%`) },
          { ...where, acao: ILike(`%${busca}%`) },
        ]
      : [where];

    const [items, total] = await this.repo.findAndCount({
      where: wheres,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  /** Valores distintos para popular os filtros da tela. */
  async opcoes() {
    const linhas: Array<{ categoria: string; acao: string; total: string }> =
      await this.repo
        .createQueryBuilder('a')
        .select('a.categoria', 'categoria')
        .addSelect('a.acao', 'acao')
        .addSelect('COUNT(*)', 'total')
        .groupBy('a.categoria')
        .addGroupBy('a.acao')
        .orderBy('a.categoria')
        .addOrderBy('a.acao')
        .getRawMany();
    return linhas.map((l) => ({ ...l, total: Number(l.total) }));
  }

  /** Resumo dos últimos N dias: volume por dia, por categoria e erros. */
  async resumo(dias = 7) {
    const desde = new Date(Date.now() - dias * 86_400_000);
    const porDia: Array<{ dia: string; total: string; erros: string }> =
      await this.repo
        .createQueryBuilder('a')
        .select(
          `to_char(a."createdAt" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`,
          'dia',
        )
        .addSelect('COUNT(*)', 'total')
        .addSelect(`COUNT(*) FILTER (WHERE a.resultado = 'erro')`, 'erros')
        .where('a."createdAt" >= :desde', { desde })
        .groupBy('dia')
        .orderBy('dia')
        .getRawMany();
    const porCategoria: Array<{ categoria: string; total: string }> =
      await this.repo
        .createQueryBuilder('a')
        .select('a.categoria', 'categoria')
        .addSelect('COUNT(*)', 'total')
        .where('a."createdAt" >= :desde', { desde })
        .groupBy('a.categoria')
        .orderBy('total', 'DESC')
        .getRawMany();
    const ativos = await this.repo
      .createQueryBuilder('a')
      .select('COUNT(DISTINCT a."userId")', 'n')
      .where('a."createdAt" >= :desde AND a."userId" IS NOT NULL', { desde })
      .getRawOne<{ n: string }>();
    return {
      dias,
      porDia: porDia.map((d) => ({
        dia: d.dia,
        total: Number(d.total),
        erros: Number(d.erros),
      })),
      porCategoria: porCategoria.map((c) => ({
        categoria: c.categoria,
        total: Number(c.total),
      })),
      usuariosAtivos: Number(ativos?.n ?? 0),
    };
  }
}
