# Arquitetura

## Backend (`backend/`)

NestJS organizado por **módulos de domínio** — cada funcionalidade vive em `src/modules/<dominio>/` com controller, service, module, `dto/`, `entities/` e testes `*.spec.ts` ao lado do código. O módulo `trends` é o modelo de referência: novos módulos (auth, users, products, analytics — pastas já criadas) devem seguir o mesmo formato.

```
backend/src/
├── main.ts                  # bootstrap, ValidationPipe global, Swagger em /docs
├── app.module.ts
├── config/                  # configurações (typeorm.config.ts lê do ConfigService)
├── common/                  # código transversal reutilizável
│   ├── decorators/  filters/  interceptors/  pipes/
├── database/
│   ├── data-source.ts       # DataSource para a CLI do TypeORM (migrations)
│   ├── migrations/  seeds/
└── modules/
    └── trends/              # módulo de referência
        ├── dto/  entities/
        ├── trends.controller.ts  trends.service.ts  trends.module.ts
        └── trends.service.spec.ts
```

Convenções:
- DTOs validados com `class-validator` e anotados com `@ApiProperty` (Swagger automático).
- Entities com `@Entity` + timestamps (`CreatedDateColumn`/`UpdateDateColumn`).
- `synchronize: true` só em desenvolvimento; produção usa migrations (`npm run migration:generate/run`).
- Prefixo global da API: `/api/v1`.

## Frontend (`frontend/`)

React + Vite. MUI para componentes prontos; styled-components para layout/estilização customizada — ambos compartilham o mesmo tema via `AppThemeProvider`.

```
frontend/src/
├── components/
│   ├── ui/          # componentes reutilizáveis puros (StatCard, futuros TrendChart, DataTable...)
│   └── layout/      # AppLayout (AppBar + Outlet), navegação
├── pages/           # uma pasta por rota (Dashboard, Trends, Products, Login)
├── routes/          # definição de rotas (react-router)
├── services/        # camada de acesso à API (axios); um service por domínio
├── hooks/           # hooks reutilizáveis (ex.: useFetch, useDebounce)
├── contexts/        # estado global (ex.: AuthContext)
├── theme/           # tema único MUI + styled-components
└── utils/
```

Padrões de reuso:
- **Páginas não chamam axios direto** — sempre via `services/`, que tipam a resposta.
- Componentes de `ui/` são "burros" (props in, JSX out), testáveis isoladamente (ver `StatCard.test.tsx`).
- Alias `@/` aponta para `src/`.
- Em dev, `/api` é proxied para `http://localhost:3000` (sem CORS local).

## Próximos passos sugeridos

1. Autenticação (JWT) — módulo `auth` no back + `AuthContext`/rota de Login no front.
2. Ingestão de dados do TikTok (job/worker de coleta de tendências).
3. Módulos `products` e `analytics` seguindo o padrão de `trends`.
4. CI (lint + testes) e ESLint/Prettier compartilhados.
