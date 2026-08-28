import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { isAdmin } from '../admin/admin.access';
import { AuditService, sanitizarDetalhe } from './audit.service';

type ReqComUser = Request & { user?: { id: string; email: string } };

/** Rotas de leitura que ainda assim valem registro. */
const GETS_AUDITADOS = new Set(['/auth/confirm']);

/** Rotas que batem o tempo todo e só sujariam a trilha. */
const IGNORADAS = [
  /^\/live\/runs\/[^/]+\/heartbeat$/,
  /^\/live\/runs\/[^/]+\/metrics$/,
];

/** Segmentos que são ids (uuid ou número) viram parte do alvo, não do nome. */
const ID_SEGMENTO = /^([0-9a-f]{8}-[0-9a-f-]{27}|\d+)$/i;

const VERBOS: Record<string, string> = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
  GET: 'get',
};

/**
 * Registra toda requisição que muda estado (não-GET) — sucesso ou erro —
 * com quem fez, onde, com o quê e o resultado. Rotas sem guard (login,
 * cadastro) entram também: o ator é lido da resposta ou do e-mail do corpo.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<ReqComUser>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const caminho = this.caminho(req);
    if (req.method === 'GET' && !GETS_AUDITADOS.has(caminho)) {
      return next.handle();
    }
    if (req.method === 'OPTIONS' || req.method === 'HEAD') return next.handle();
    if (IGNORADAS.some((r) => r.test(caminho))) return next.handle();

    const inicio = Date.now();
    return next.handle().pipe(
      tap({
        next: (corpo) =>
          this.gravar(req, res.statusCode || 200, 'ok', null, corpo, inicio, caminho),
        error: (err) => {
          const status = err instanceof HttpException ? err.getStatus() : 500;
          this.gravar(
            req,
            status,
            'erro',
            err?.message ?? String(err),
            null,
            inicio,
            caminho,
          );
        },
      }),
    );
  }

  private caminho(req: Request): string {
    const url = (req.originalUrl || req.url || '').split('?')[0];
    return url.replace(/^\/api\/v\d+/, '');
  }

  private gravar(
    req: ReqComUser,
    statusCode: number,
    resultado: 'ok' | 'erro',
    erro: string | null,
    corpo: unknown,
    inicio: number,
    caminho: string,
  ) {
    try {
      const segmentos = caminho.split('/').filter(Boolean);
      const categoria = (segmentos[0] ?? 'raiz').slice(0, 40);
      const alvoId = segmentos.find((s) => ID_SEGMENTO.test(s)) ?? null;
      const acao = `${categoria}.${this.nomeAcao(req.method, segmentos.slice(1))}`;

      // Ator: guard autenticado → resposta de login (user) → e-mail do corpo.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const respUser = (corpo as { user?: { id?: string; email?: string } } | null)
        ?.user;
      const userId = req.user?.id ?? respUser?.id ?? null;
      const userEmail =
        req.user?.email ??
        respUser?.email ??
        (typeof body.email === 'string' ? body.email.toLowerCase().trim() : null);

      const detalhe: Record<string, unknown> = {};
      if (body && typeof body === 'object' && Object.keys(body).length) {
        detalhe.body = sanitizarDetalhe(body);
      }
      if (req.query && Object.keys(req.query).length) {
        detalhe.query = sanitizarDetalhe(req.query);
      }
      const arquivo = (req as unknown as { file?: { originalname: string; size: number } })
        .file;
      if (arquivo) detalhe.arquivo = { nome: arquivo.originalname, bytes: arquivo.size };

      /*
       * `req.ip`, e não o `X-Forwarded-For` cru.
       *
       * Ler o cabeçalho na mão registrava o que o CLIENTE escreveu: sem proxy
       * na frente, qualquer um mandava `X-Forwarded-For: 1.2.3.4` e a trilha de
       * auditoria — que existe para dizer de onde partiu uma ação
       * administrativa — passava a guardar o endereço que o atacante escolheu.
       * Um log forjável é pior que log nenhum, porque parece prova.
       *
       * O Express já faz essa conta corretamente a partir de `trust proxy`
       * (configurado no boot, ver `main.ts`): com proxy declarado ele pula os
       * saltos confiáveis e devolve o cliente; sem proxy declarado ele ignora o
       * cabeçalho e devolve quem de fato conectou.
       */
      const ip = req.ip || req.socket?.remoteAddress || null;

      this.audit.registrar({
        userId,
        userEmail,
        categoria,
        acao: acao.slice(0, 120),
        metodo: req.method,
        rota: caminho.slice(0, 500),
        alvoId,
        statusCode,
        resultado,
        erro: erro ? erro.slice(0, 500) : null,
        detalhe: Object.keys(detalhe).length ? detalhe : null,
        ip: ip ? ip.slice(0, 64) : null,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
        duracaoMs: Date.now() - inicio,
        admin: !!userEmail && isAdmin(userEmail),
      });
    } catch {
      // Auditoria jamais quebra a requisição.
    }
  }

  /**
   * `POST campaigns/:id/render-all` → `render_all`
   * `DELETE campaigns/:id`          → `delete`
   * `POST campaigns`                → `create`
   * `PATCH campaigns/scenes/:id`    → `scenes.update`
   * `POST auth/login`               → `login`
   */
  private nomeAcao(metodo: string, resto: string[]): string {
    const temId = resto.some((s) => ID_SEGMENTO.test(s));
    const partes = resto
      .filter((s) => !ID_SEGMENTO.test(s))
      .map((s) => s.replace(/-/g, '_'));
    const verbo = VERBOS[metodo] ?? metodo.toLowerCase();
    if (!partes.length) return verbo;
    const ultimoEhAcao = temId && resto.at(-1) === resto.filter((s) => !ID_SEGMENTO.test(s)).at(-1);
    // POST em ".../:id/acao" é uma ação nomeada (render, clone, end) — o verbo
    // "create" só confundiria. Nos demais casos, sub-recurso + verbo.
    if (metodo === 'POST' && ultimoEhAcao) return partes.join('.');
    if (metodo === 'POST' && !temId && partes.length === 1 && !/s$/.test(partes[0])) {
      return partes[0]; // auth/login, auth/register, studio/analyze
    }
    return `${partes.join('.')}.${verbo}`;
  }
}
