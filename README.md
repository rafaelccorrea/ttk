# PikPok

Plataforma de insights e tendências para lojas que atuam no TikTok (visão de mercado, produtos em alta, hashtags virais — no espírito do GeraViral).

## Estrutura

```
pikpok/
├── backend/    # API NestJS + TypeORM + PostgreSQL + Swagger + Jest
├── frontend/   # React + Vite + Material UI + styled-components + Vitest
├── docs/       # Documentação de arquitetura e decisões
└── docker-compose.yml  # PostgreSQL para desenvolvimento
```

## Rodando em desenvolvimento

Pré-requisitos: Node 20+ e um Postgres — qualquer um destes:
- **Supabase** (recomendado p/ produção): crie um projeto e preencha `DATABASE_URL` + `SUPABASE_JWT_SECRET` no `backend/.env` e `VITE_SUPABASE_*` no `frontend/.env`;
- **Docker**: `docker compose up -d`;
- **Postgres local**: ajuste `DB_PASSWORD` no `backend/.env` e rode `node scripts/create-db.js`.

```bash
# 1. Backend (http://localhost:3000, Swagger em /docs)
cd backend
cp .env.example .env      # ajuste o banco (ver acima)
npm install
node scripts/create-db.js # cria o banco local, se necessário
npm run seed              # popula catálogo, métricas e cofre de prompts
npm run start:dev

# 2. Frontend (http://localhost:5173, com proxy para a API)
cd frontend
cp .env.example .env      # opcional: chaves do Supabase (sem elas, modo demo)
npm install
npm run dev
```

## Autenticação (multi-usuário)

- Com Supabase configurado: login/cadastro por e-mail e senha via Supabase Auth; o backend valida o JWT (`SUPABASE_JWT_SECRET`).
- Sem Supabase (dev): "modo demo" — `POST /api/v1/auth/dev-login` emite um JWT local; cada e-mail é um usuário distinto.
- Todos os dados de usuário (favoritos, roteiros) são escopados pelo `sub` do token — nada é fixo.

## Assinatura (paywall na entrada)

Não existe plano gratuito. O produto entrega dado de mercado comprado de
fornecedor pago (EchoTik) e IA cobrada por chamada — conta grátis queimava custo
por visitante e entregava justamente aquilo que se vende. Então:

- `plan = 'free'` **não é um plano**: é o estado "conta criada, pagamento
  pendente". Rank 0, nenhum recurso liberado (`FEATURE_MIN_PLAN` em
  `backend/src/modules/billing/billing.config.ts`).
- Quem está nesse estado — cadastro novo ou assinatura encerrada — cai em
  `/assinatura`, uma tela **fora** do app logado (`frontend/src/pages/Subscribe`).
- O bloqueio real é do backend: `PlanFeatureGuard` responde 403 em produtos,
  vídeos, criadores, tendências, estúdio e coleta. O gate do front é só UX.
- A prova de valor mora antes do login: `GET /api/v1/showcase` alimenta a
  amostra pública da landing — 8 produtos, defasados, com vendas em faixa e sem
  loja, receita ou link do TikTok (`backend/src/modules/showcase/`).
- **Contas de cortesia**: `COMP_ACCOUNT_EMAILS` (separado por vírgula) mantém as
  contas da equipe em Business sem passar pelo checkout, e imunes a downgrade.
  Preencha antes de subir o paywall — senão o time perde o acesso junto.
- **Ciclo de vida**: `customer.subscription.deleted` devolve a conta para `free`
  (o Stripe só emite esse evento quando o período pago termina, então cancelar
  não corta na hora). `invoice.payment_failed` apenas registra — quem decide o
  corte é o dunning do Stripe. O cliente cancela e troca cartão sozinho pelo
  Billing Portal, em Perfil → Gerenciar assinatura.
- Os créditos comprados **não** são apagados no downgrade: ficam no saldo e
  voltam a valer se a pessoa reassinar.

> Segurança: as tabelas do Supabase estavam "Unrestricted" — com RLS desligado,
> a `anon key` (pública, vai no bundle) permitia ler e escrever tudo via
> PostgREST, inclusive `app_users.plan`. A migration `EnableRowLevelSecurity`
> revoga `anon`/`authenticated` e liga RLS sem policies em todas as tabelas, e
> a `HardenRlsDefaults` fecha a recaída: ela revoga também os *default
> privileges* do schema, para que tabela criada daqui em diante já nasça sem
> acesso público. Isso não é hipotético — `api_raw_responses` foi criada entre
> as duas e ficou, em produção, legível e truncável por qualquer um com a
> `anon key`.
>
> Ainda assim, **RLS não tem default em Postgres**: ao criar uma tabela nova,
> ligue o RLS dela na mesma migration. Para conferir o estado do banco:
> `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'`.
>
> A API atravessa o RLS porque conecta como dono das tabelas (`postgres`, com
> `rolbypassrls`). Se um dia ela passar a usar um role comum, será preciso criar
> policies — senão o deny-all vale para ela também.

## Funcionalidades

- **Descoberta**: ranking de produtos por 7/30/90 dias com crescimento %, filtros por categoria/busca, detalhe com série diária de vendas e favoritos por usuário.
- **Estúdio IA**: roteiros de live (ciclos Apresentação→Oferta→Garantia→CTA) e de vídeo (Gancho→Corpo→CTA) via API da Anthropic (`ANTHROPIC_API_KEY`; sem a chave, gerador de template local). Roteiros salvos por usuário.
- **Cofre de Prompts**: prompts de vídeo/imagem IA com campos a preencher e copiar.
- **Dashboard**: números agregados do catálogo + top produtos da semana.

Tudo acima exige assinatura ativa — ver "Assinatura (paywall na entrada)".
> **Minha Loja foi descontinuada.** O módulo `stores` (cadastro de loja, importação de
> planilhas do Seller Center, curva ABC, alertas por e-mail) saiu do produto. As tabelas
> `stores*` continuam no banco pela migration `1786665600000-AddStores` — se quiser
> derrubá-las, crie uma migration de drop.

## Banco de dados e migrations

O schema é versionado em `backend/src/database/migrations`. Em desenvolvimento o
`synchronize` ainda cria as tabelas, mas **em produção o provisionamento é por migration**:

```bash
cd backend
npm run migration:run                                   # aplica as pendentes
npm run migration:generate -- src/database/migrations/Nome  # gera a partir das entidades
npm run typeorm -- schema:log                           # confere drift (não altera nada)
```

As migrations são idempotentes, então bancos que já rodaram com `synchronize` podem
aplicá-las sem quebrar.

## Testes

```bash
cd backend && npm test    # Jest (unit) | npm run test:e2e
cd frontend && npm test   # Vitest + Testing Library
```

O CI (`.github/workflows/ci.yml`) roda build + testes dos dois lados e, num Postgres
limpo, aplica as migrations duas vezes (provando idempotência) e falha se as entidades
divergirem do schema resultante.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md) — organização de pastas, convenções e padrões de reuso.
- [Precificação](docs/PRECIFICACAO.md) — de onde vem cada valor cobrado e como validá-lo.
- [Conta gratuita](docs/CONTA-FREE.md) — o modo amostra: o que o não assinante vê e por quê.
- Swagger da API: `http://localhost:3000/docs` com o backend rodando.
