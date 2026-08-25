# Auditoria ponta a ponta

Toda ação de qualquer conta fica registrada na tabela `audit_logs` e aparece
na área **Administração → Auditoria** (`/admin`), com filtros.

## O que é registrado

- **Automático (interceptor global `AuditInterceptor`)**: toda requisição
  que muda estado — `POST`, `PATCH`, `PUT`, `DELETE` — de qualquer módulo,
  com sucesso ou erro. Inclui rotas anônimas: login (inclusive senha errada),
  cadastro, Google, reset de senha, webhook da Stripe, `GET /auth/confirm`.
- **Explícito (`AuditService.evento`)**: eventos fora do HTTP — hoje, jobs de
  IA concluídos/falhos (`jobs.<tipo>.concluido|falhou`).
- **Ignorado de propósito**: leituras (`GET`) e batidas de
  `live/runs/:id/heartbeat|metrics`.

Cada linha guarda: quem (id + e-mail na hora), área (`categoria`), nome estável
da ação (`acao`, ex. `campaigns.render_all`, `auth.login`, `studio.scripts.delete`),
verbo/rota/id alvo, status HTTP, `ok|erro` + mensagem, corpo sanitizado
(senha/token/secret viram `[oculto]`, truncado em 4 KB), IP, user-agent,
duração e se o ator é da equipe (`ADMIN_EMAILS`).

A gravação é fire-and-forget: falha de auditoria só vai para o log do servidor,
nunca derruba a requisição.

## API (admin)

- `GET /admin/audit` — filtros: `busca` (e-mail/rota/ação), `userId`,
  `categoria`, `acao`, `resultado=ok|erro`, `admin=true|false`, `desde`, `ate`
  (ISO), `page`, `limit` (≤200).
- `GET /admin/audit/opcoes` — categorias/ações existentes com contagem.
- `GET /admin/audit/resumo?dias=7` — volume por dia e por área, erros, contas ativas.

## Migração

`1786671200000-CreateAuditLogs.ts` — roda sozinha em produção (`migrationsRun`).
