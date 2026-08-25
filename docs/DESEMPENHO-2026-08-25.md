# Desempenho das APIs — diagnóstico e correções (2026-08-25)

## O achado que muda tudo

O banco (Supabase) está em **`aws-0-ca-central-1`** (Canadá). Medido daqui:
`connect` ≈ 1.050 ms, **`SELECT 1` ≈ 160 ms**. As tabelas são minúsculas
(a maior tem ~1.400 linhas; `pg_stat_statements` não mostra query pesada
além do ranking da vitrine, que já tinha cache). Ou seja: **o custo de cada
tela é o número de idas ao banco × 160 ms**, não o peso das queries.

Isso muda a prioridade: índice e otimização de SQL rendem quase nada aqui;
o que rende é **menos round-trips** (cache, paralelismo, dedup).

> Recomendação estrutural (decisão de negócio, não feita): migrar o projeto
> Supabase para **`sa-east-1` (São Paulo)** ou para a mesma região da VPS.
> Sozinho isso divide a latência de toda API por ~5–8.

## O que foi corrigido

### Backend

| Onde | Antes | Depois |
|---|---|---|
| `SupabaseAuthGuard` → `UsersService.ensure` | 1 SELECT (`id OR email`) em **toda** request autenticada | cache em memória por usuário (30 s); busca por `id` primeiro, e-mail só no cadastro; `lastSeenAt` gravado sem `await` |
| `PlanFeatureGuard` / `FreePlanGuard` | mais 1 SELECT idêntico em `app_users` cada | leem `request.appUser` carregado pelo guard de auth |
| `GET /billing/wallet` | 5 queries em série | `ensureSignupBonus` → (`user` ‖ `history`) → `consumo` |
| `GET /trends/overview` | 4 queries em série, sem cache | 3 em paralelo, cache de 5 min (dado muda 1×/dia) |
| `GET /analytics/overview` | 6 agregações por visita | cache 60 s por usuário |
| Pool do TypeORM | padrão do node-pg (10 conexões, sem timeout) | `max` 20 (`DB_POOL_MAX`), `statement_timeout` 30 s, keep-alive |
| Respostas | sem compressão | `compression` (gzip/br) acima de 1 KB |

Invalidação do cache de usuário: `UsersService.invalidar(id)` é chamado em
todo `update` de plano em `BillingService` e em `updateProfile`.

### Frontend

| Onde | Antes | Depois |
|---|---|---|
| `billingService.wallet()` | até **4 GETs idênticos** por navegação (layout + 3 gates + `useSaldo`), 2 deles bloqueando a renderização | promessa compartilhada em voo + cache 15 s, chaveado pelo token; `CREDITS_CHANGED_EVENT` zera o cache |
| Rotas | 1 chunk de **1,2 MB** com as 30 páginas | `React.lazy` nas páginas + `manualChunks` (react / mui); app inicial ≈ 230 KB + vendors cacheáveis |
| `/admin` | `overview` e `users` em série + `users` duplicado pelo debounce na montagem | `Promise.all` + guarda de primeira busca |

## O que ficou de fora (próximos passos, por ordem de retorno)

1. **Região do banco** (ver acima) — maior ganho, decisão do produto.
2. `GET /videos/:id/playback` resolve EchoTik + espelha no S3 **dentro do GET**
   (6–17 s no cache miss). Deveria virar job + polling.
3. Polling que não pausa com a aba escondida (`Generations` 6 s por item,
   `Campaigns` 6 s, `Ingestion` 5 s, `Cuts` 4 s, `SupportFab` 60/10 s).
4. Listas sem paginação: `/combinations*`, `/videogen`, `/cuts`,
   `/studio/scripts`, `/live/sessions`, `/campaigns/products|personas`.
5. `MediaMirrorService.objectCache` guarda até 600 objetos inteiros (MP4
   inclusive) em RAM — risco de OOM; limitar por bytes ou redirecionar para
   URL pré-assinada.
6. `getCount()` a cada página em `products.rank`, `videos.rank`, `creators`.

## Como conferir

- Backend: `npx tsc --noEmit` e `npx jest src/modules/billing src/modules/users src/modules/auth` (94 testes).
- Frontend: `npx tsc --noEmit`, `npx vite build` (ver tamanhos dos chunks), `npx vitest run` (35 testes).
- No navegador: aba Network numa navegação `/produtos` → `/multiplicador` deve mostrar **um** `GET /billing/wallet` por tela e `content-encoding: gzip` nas respostas JSON.
