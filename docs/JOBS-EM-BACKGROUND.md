# Gerações de IA em background (progresso global)

**Regra:** nenhuma geração de IA pode morrer porque o usuário saiu da tela ou
fechou a aba. O request só cria um *job*, devolve o id, e o trabalho segue no
servidor. A tela acompanha pelo progresso global e reconecta ao voltar.

## Como funciona

- **Tabela `ai_jobs`** (`backend/src/modules/jobs/entities/ai-job.entity.ts`):
  `tipo`, `titulo`, `status` (`na_fila` → `rodando` → `concluido`/`falhou`),
  `progresso` (0–100), `etapa` (texto humano), `referenciaId` (campanha etc.),
  `resultado` (jsonb), `erro`, `heartbeatAt`, `estornoAcao`/`estornoQuantidade`.
- **`JobsService.iniciar(pedido, fn)`** cria a linha e roda `fn` sem esperar,
  no próprio processo da API (mesmo desenho dos Cortes e do Live Copilot; não
  há worker separado). Bate `heartbeatAt` a cada 30 s. `fn` recebe um
  `JobContexto` com `progresso(pct, etapa)` e `cobrado(acao, qtd)`.
- **Cron a cada 2 min (`reabrirTravados`)**: job sem heartbeat há 5 min e que
  não está rodando neste processo morreu com o servidor (deploy/restart). Vira
  `falhou` com mensagem honesta e, se `cobrado()` foi chamado, estorna via
  `BillingService.refund`. Falha normal (exceção dentro de `fn`) NÃO estorna
  aqui — o `withCharge` de quem lançou já devolveu.
- **Endpoints** (`/jobs`, autenticados): `GET /jobs/ativos` (vivos + terminados
  nos últimos 30 min não dispensados), `GET /jobs/:id`, `POST /jobs/:id/dispensar`.

## O que virou job

| Rota | tipo | resultado |
|---|---|---|
| `POST /studio/transcribe` | `transcribe` | `{ transcript }` |
| `POST /studio/analyze` | `analyze` | `Script` |
| `POST /studio/scripts/generate` | `script` | `Script` |
| `POST /campaigns/:id/script` | `campaign_script` | `CampaignDetail` |
| `POST /campaigns/:id/assemble` | `campaign_assemble` | `CampaignDetail` |

Validação (produto existe, conteúdo permitido, cenas prontas…) roda **antes**
de criar o job, para o erro voltar como 4xx e não como job falhado
(`prepararGeracao`, `validarGeracaoDeRoteiro`, `validarMontagem`).

Já eram background antes e ficaram como estão: Cortes (`cut_jobs`),
Multiplicador (`combination_videos`), Live Copilot (`live_sessions`),
redublagem de cena, gerações avulsas (`generated_media`).

## Fila da Fábrica sem depender da tela

A fila de cenas (`avancarFila`), a colheita das gerações (`colherCena`) e a
montagem automática só rodavam dentro de `GET /campaigns/:id/refresh` — o
polling da tela. Agora `CampaignsService.avancarCampanhasEmAndamento` (cron a
cada 20 s) chama `atualizarCampanha` para toda campanha com cena
`renderizando` ou `renderQueue` ligada. A tela aberta só deixa a atualização
mais rápida.

## Frontend

- `src/services/jobs.service.ts`: `rodar(disparar, onUpdate)` cria o job,
  registra em `localStorage` (`pikpok.job.<tipo>`) e espera com polling de
  2,5 s; `pendente(tipo)`/`esperar(id)` fazem a retomada quando a tela
  remonta; `rotaDoJob` diz para onde a bandeja navega.
- `src/components/layout/JobsTray.tsx`: bandeja fixa no canto inferior
  esquerdo de toda a área logada — polling de 4 s com job vivo, 60 s ocioso,
  atualização imediata no evento `pikpok:job-started`. Mostra título, etapa,
  barra de progresso; concluído/falhou pode ser dispensado.
- Telas **Analisar**, **Estúdio** e **Campanhas** retomam o job pendente ao
  montar (Campanhas via recarga do detalhe + bandeja).

## Para adicionar uma geração nova

1. Validar tudo que pode falhar no controller, antes do job.
2. `this.jobs.iniciar({ userId, tipo, titulo, referenciaId }, (ctx) => …)`.
3. Dentro do `withCharge`, chamar `ctx.cobrado(acao, qtd)` logo após a cobrança.
4. Reportar `ctx.progresso()` nas etapas que demoram.
5. No frontend, disparar com `jobsService.rodar(...)`, adicionar o `tipo` em
   `AiJobTipo` (backend e frontend) e a rota em `rotaDoJob`.
