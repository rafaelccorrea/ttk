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

## Funcionalidades

- **Descoberta**: ranking de produtos por 7/30/90 dias com crescimento %, filtros por categoria/busca, detalhe com série diária de vendas e favoritos por usuário.
- **Estúdio IA**: roteiros de live (ciclos Apresentação→Oferta→Garantia→CTA) e de vídeo (Gancho→Corpo→CTA) via API da Anthropic (`ANTHROPIC_API_KEY`; sem a chave, gerador de template local). Roteiros salvos por usuário.
- **Cofre de Prompts**: prompts de vídeo/imagem IA com campos a preencher e copiar.
- **Dashboard**: números agregados do catálogo + top produtos da semana.

## Testes

```bash
cd backend && npm test    # Jest (unit) | npm run test:e2e
cd frontend && npm test   # Vitest + Testing Library
```

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md) — organização de pastas, convenções e padrões de reuso.
- Swagger da API: `http://localhost:3000/docs` com o backend rodando.
