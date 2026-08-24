# Roteiro de QA ponta a ponta — Live Copilot e catálogo (release 23/08/2026)

Objetivo: validar, **pelo navegador** (site), **pelo app desktop em simulação**,
**na Stripe** e **em produção depois do deploy**, as sete features da release e
as regras de preço/horas. Cada passo tem o resultado esperado e como provar no
banco quando a tela não basta. Marque ✅/❌ na coluna "OK".

## Regras que este roteiro valida (fonte: `backend/src/modules/billing/billing.config.ts`)

| Regra | Valor |
|---|---|
| Preços mensais / anuais | Essencial 39,90 / 399,90 · Pro 89,90 / 899,90 · Business 249,90 / 2.499,90 |
| Créditos | 450 (4.600 anual) · 1.000 (10.400) · 2.800 (28.800) |
| **O plano VEM com horas de live** (bônus único na adesão) | Essencial **15h** · Pro **40h** · Business **60h** — renovação não repete, upgrade concede a diferença |
| Hora mensal recorrente | **não existe** em nenhum plano |
| Cortesia de 10 min de live | **exclusiva da conta free** (assinante não ganha); painel do copiloto abre no free |
| Packs de live | 1h 9,90 · 5h 39,90 · 15h 99,90 · 40h 219,90 — qualquer conta com a feature |
| Packs de crédito | 100 cr 14,90 · 300 cr 39,90 · 1.000 cr 119,90 (só assinante) |
| Bônus de cadastro | 25 créditos + 1 vídeo com IA de cortesia |
| Envio automático no chat | só Business (`trocarModo`) |
| Freios de tempo | bloco mínimo 10 min por live; duração máx. 6h (Essencial/Pro) / 24h (Business) |
| UI | nunca nomear fornecedor/modelo de IA ("IA", nunca Claude/GPT/Whisper) |

---

## 0. Ambiente

| Peça | Como subir | Aponta para |
|---|---|---|
| Backend local | `cd backend && npm run start` (porta 3000; `nest start` compila os specs — erro de TS em spec derruba o boot) | Supabase (DATABASE_URL do `.env`) |
| Site (código novo) | `cd frontend && DEV_API_TARGET=http://localhost:3000 npx vite --port 5175` | backend local |
| Site (espelho de prod) | `npm run dev` (5173/5174; o `.env` tem `DEV_API_TARGET` de prod) | produção |
| Desktop (simulação) | `cd desktop && npm run dev:sim` | backend local (`NODE_ENV=development`) |

Pré-requisitos: migrations aplicadas (`cd backend && npm run migration:run` —
esperado "No migrations are pending"; a mais recente é `AddLiveProductImage`); conta da equipe em `COMP_ACCOUNT_EMAILS`
(não gasta minutos) **e** uma conta free de teste (ex.: `free.teste@…`).

Consulta de apoio ao banco (no `backend/`):

```
node -e "require('dotenv').config();const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();console.table((await c.query('SELECT id,status,\"minutesCharged\",\"messagesSeen\",\"repliesGenerated\",\"endReason\" FROM live_runs ORDER BY \"createdAt\" DESC LIMIT 3')).rows);console.table((await c.query('SELECT tipo,acao,detalhe FROM live_run_events ORDER BY \"createdAt\" DESC LIMIT 5')).rows);console.table((await c.query('SELECT minutes,kind,description FROM live_minute_transactions ORDER BY \"createdAt\" DESC LIMIT 5')).rows);await c.end()})()"
```

---

## 1. Stripe × catálogo (antes de qualquer teste de compra)

| # | Passo | Esperado | OK |
|---|---|---|---|
| 1.1 | `cd backend && npm run stripe:check` | "Tudo alinhado." — 13 linhas `OK` (3 planos × 2 ciclos, 3 packs de crédito, 4 packs de live), todas `ativo`, moeda BRL | ✅ 23/08 21:05 |
| 1.2 | Painel da Hostinger (env de produção) | Os 6 `STRIPE_PRICE_*` de Business e packs de live iguais aos do `backend/.env` local (IDs `price_1U7l…` criados em 23/08) | |
| 1.3 | Dashboard Stripe → Produtos | Só produtos "PikPok" têm prices ativos apontados pelo env; nenhum price ativo órfão; produtos de outros projetos intocados | |

> Preço na Stripe vence o `priceBrl` do config no checkout. **Mudou preço no código = criar
> price novo, apontar env local + Hostinger, arquivar o antigo, rodar `stripe:check`.**

## 2. Site público (landing, deslogado — `http://localhost:5175/`)

| # | Passo | Esperado | OK |
|---|---|---|---|
| 2.1 | Abrir `/` **deslogado** (logado redireciona para `/produtos`) | Seção **Live Copilot** presente (4 cards: respostas com a sua base, envio automático no Business, detector de aviso do TikTok, fixar produto), sem preço e sem nome de IA | |
| 2.2 | Cards de plano | 39,90 / **89,90** / **249,90**; anual 399,90 / 899,90 / 2.499,90 (Business com anual) | |
| 2.3 | Perks | Essencial "…o plano vem com 15 horas de live"; Pro "…40 horas"; Business "…60 horas" + "Envio automático (exclusivo)". **Nenhum** "por mês" em horas | |
| 2.4 | FAQ "Preciso de cartão?" e CTA final | "25 créditos de boas-vindas" + "10 minutos de Live Copilot de cortesia" (não "30 créditos") | |
| 2.5 | FAQ "Como funcionam os créditos?" | Explica a moeda de horas de live (separada), horas de adesão 15/40/60 e packs 9,90 / 39,90 / 99,90 / 219,90 | |
| 2.6 | Buscar na página por "Claude", "GPT", "Whisper", "OpenAI" | Zero ocorrências | |

## 3. Site logado — Planos & Créditos (`/planos`)

| # | Passo | Esperado | OK |
|---|---|---|---|
| 3.1 | Conta **free** | Chip "10 min grátis" no topo; menu "Copiloto de Live" **sem cadeado** e a página `/copiloto` **abre** (não mostra "Esta parte abre com um plano" — o `RequireSubscription` respeita `wallet.features`); bloco "Horas de Live Copilot" visível com "você tem 10 minutos de cortesia para conhecer; assinando, o plano vem com 15, 40 ou 60 horas"; packs de crédito desabilitados | ✅ 23/08 |
| 3.2 | Cards de plano | Preços/perks idênticos ao item 2.2/2.3; "Roteiros e análises com IA" (sem "Claude") | ✅ 23/08 |
| 3.3 | Bloco de horas | Packs 9,90 / 39,90 / 99,90 / 219,90; "melhor preço/hora" no de 40h; texto cita bloco mínimo de 10 min | ✅ 23/08 |
| 3.4 | Conta **assinante** (qualquer plano) | **Sem** chip/frase de cortesia (`trialAvailable=false` mesmo sem ter usado); frase "cada plano já começa com horas de live inclusas na adesão" | ✅ (código: trialAvailable só free; sem conta assinante para ver) |
| 3.5 | Tela Analisar Vídeo (`/analisar`) durante transcrição | "Transcrevendo com IA…" | ✅ (texto conferido no código) |

## 3b. Site — foto do produto da base (`/live/<base>` → editar produto)

| # | Passo | Esperado | OK |
|---|---|---|---|
| 3b.1 | Abrir um produto da base → campo **Foto** → enviar JPG/PNG | Miniatura aparece no diálogo; `live_products.imageUrl` preenchido com URL `/media/s3/live-products/…` (bucket privado, sem expirar) | ✅ 23/08 22:10 — webp no bucket, servido 200 |
| 3b.2 | Lista de produtos da base | Miniatura ao lado do nome; sem foto, placeholder neutro | ✅ 23/08 |
| 3b.3 | "Remover foto" | `imageUrl` volta a `null`; placeholder na lista | ✅ 23/08 |
| 3b.4 | Arquivo inválido (PDF / >limite) | Recusado com mensagem clara, sem alterar o produto | ✅ 23/08 — .txt recusado |
| 3b.5 | Foto em produto de OUTRA conta (chamar `POST /live/products/:id/photo` com id alheio) | 404/403 — nunca grava | ✅ (teste unitário live.service.foto.spec) |

## 4. Adesão, renovação e upgrade (webhook da Stripe — usar conta de teste, cartão real ou evento reenviado)

| # | Passo | Esperado (extrato `live_minute_transactions` + `app_users`) | OK |
|---|---|---|---|
| 4.1 | Conta free assina **Pro** | `purchase` de **+2.400 min** "40 horas de live inclusas na adesão ao plano pro"; `liveSignupMinutesGranted=2400`; **nenhum** lançamento `trial`; saldo de live no site = 40h | |
| 4.2 | Reenviar o mesmo `invoice.paid` (renovação) | Nenhum lançamento de adesão novo | |
| 4.3 | Upgrade Pro → **Business** | `purchase` de **+1.200 min** (20h), `liveSignupMinutesGranted=3600` | |
| 4.4 | Downgrade Business → Essencial | Nenhum lançamento; saldo mantido | |
| 4.5 | Conta free abre a primeira live | `trial` de +10 min uma vez; conta que já assinou **não** recebe trial | |
| 4.6 | Checkout de pack de live (1h) com conta Essencial | Stripe cobra **R$ 9,90** (price novo); webhook credita +60 min | |
| 4.7 | Checkout de pack de crédito com conta free | Recusado (só assinante) — texto explica | |

## 5. Desktop — Configurações

| # | Passo | Esperado | OK |
|---|---|---|---|
| 5.1 | Abrir Configurações | Tela densa em seções: **Respostas** (responder a partir de / descartar abaixo de / tamanho do lote, valor atual à direita), **Chat** (lista negra, **Bloquear espectadores**), **Vitrine** (**Rotação automática de produtos** — slider 2–60 min só aparece com o switch ligado), **Proteção** (**Detectar avisos do TikTok** ligado, **Encerrar a live ao detectar aviso** desligado, com alerta), **Sistema** (atualizar + conta). Botão **Salvar ajustes** fixo no rodapé, sempre visível | |
| 5.2 | Digitar `@teste, curioso` em Bloquear e salvar | Reabrir mostra `teste, curioso` (normalizado) | ✅ 24/08 via ponte: '@curioso_chato' → 'curioso_chato' |
| 5.3 | Ligar rotação com 2 min e salvar | Chip "valendo no próximo lote" | ✅ 24/08 via ponte (rotação 2 min salva) |
| 5.4 | Detector desligado | Switch "Encerrar ao detectar" desabilitado | |

## 6. Desktop — live simulada (cockpit)

| # | Passo | Esperado | OK |
|---|---|---|---|
| 6.1 | Escolher base pronta → Conectar live | Coluna direita em **abas**: aba **Respostas** (padrão) com escalações **≤4 cards** (+N aguardando) + prontas para copiar; aba **Produtos** com contagem no rótulo; barra de status embaixo. Escalação nova com a aba Produtos ativa mostra a contagem em vermelho na aba Respostas, sem trocar de aba | ✅ 24/08 layout em abas reconferido (screenshot: Respostas 8 / Produtos 11, chat sobreposto à esquerda) |
| 6.2 | Banco após ~1 min | Run `conectando → ativa`; extrato com **"10 minutos"** na abertura (bloco mínimo) e 1 min por batimento depois; conta da equipe registra `minutes: 0` | ✅ 24/08 run 60b8563b: 10 min na abertura, ativa com min=1 |
| 6.3 | Chat rodando ~2 min | Respostas com o preço da base; `isQuestion` marcado nas perguntas; escalações nos casos de baixa confiança; audiência (viewers/likes) na run | ✅ 24/08 15/16 isQuestion, 13 respostas, 8 escalações, 21 viewers |
| 6.4 | Aba **Produtos** | Campo "Buscar produto…" no topo (filtra sem acento/caixa) + **lista em altura cheia** com rolagem própria: miniatura 40×40 (ou inicial do nome quando sem foto), nome em 1 linha, preço em R$ (ou "sem preço"), botão **Fixar** à direita; aviso de rotação parada troca para esta aba sozinho | ✅ 24/08 aba Produtos reconferida (busca 'a07' → 1 linha com foto, sem preço, Fixar) |
| 6.4b | Clicar **Fixar** em um item | Botão vira "Fixando…" e os demais desabilitam; depois "Não encontrei este produto no painel… fixe manualmente" (esperado na simulação) e evento `pin_produto · falhou · painel_produtos` | ✅ 24/08 evento pin_produto · falhou · painel_produtos |
| 6.4c | Produto com foto enviada pelo site (3b.1) | Miniatura carrega no cockpit (imagem vinda da API — se aparecer quebrada, é CSP `img-src` do renderer) | ✅ 24/08 screenshot: foto do Samsung A07 carregada (img.complete) |
| 6.5 | Rotação ligada (2 min) | Após 3 falhas seguidas: linha discreta "rotação automática foi pausada" na seção de produtos — **sem** faixa vermelha | |
| 6.6 | Bloquear um @ do roteiro simulado | Mensagens dele não viram resposta nem entram em `live_chat_messages` | ✅ (não verificável no banco: autor anonimizado; coberto por teste unitário usuarioEstaBloqueado) |
| 6.7 | Encerrar pelo botão do painel | Run `encerrada` com **`endReason='manual'`** (não `erro`); resumo da live na tela | ✅ 24/08 run 60b8563b: encerrada / endReason=manual (via ponte.encerrar) |
| 6.8 | Fechar o app com live aberta | Run `encerrada` / `manual`, motivo "O aplicativo foi fechado." | |
| 6.9 | Lado esquerdo (simulação): vídeo em cima, chat embaixo | Vídeo ocupa ~65% da altura, chat em área DEDICADA abaixo (sem sobreposição); **divisória arrastável** entre os dois (proporção lembrada ao reabrir) | |
| 6.10 | Rolar o chat para cima durante a live | O chat NÃO puxa de volta a cada mensagem; aparece o botão "↓ novas mensagens"; clicar volta ao fim | |
| 6.11 | Arrastar a borda esquerda do painel da direita | Painel muda de largura (mín. 460px, máx. 70% da janela); padrão **640px** fixo (não muda ao maximizar); largura lembrada ao reabrir | |

> Em dev, editar arquivo do `main` reinicia o Electron e derruba a run em curso — não é bug.

## 7. Freios de tempo (via banco)

| # | Como | Esperado | OK |
|---|---|---|---|
| 7.1 | `UPDATE live_runs SET "minutesCharged"=360 WHERE id=<run ativa, conta Pro>` e esperar o batimento | Run `encerrada`, `endReason='limite_duracao'`; desktop mostra "atingiu o limite de duração do plano" | |
| 7.2 | Mesmo com conta Business | Só encerra em 1.440 | |
| 7.3 | Conta free com `liveMinutes=0` e cortesia usada tenta abrir run | 402 "Suas horas de live acabaram" com CTA de assinar | |

## 8. Detector de aviso e pin — com TikTok real (não simulável)

| # | Como | Esperado | OK |
|---|---|---|---|
| 8.1 | Live real; forçar um banner (ou apontar `LIVE_ENVIO_SELETORES_AVISO` para um elemento existente, só para o teste) | Em ≤15s: envio pausado, faixa "O TikTok emitiu um aviso — envio pausado", evento `aviso_tiktok · pausado` | |
| 8.2 | Mesmo cenário com "Encerrar ao detectar" ligado | Clique no botão de encerrar do TikTok + run `endReason='aviso_tiktok'` | |
| 8.3 | Cascata errada de propósito | Linha em `live_selector_failures` com `context='aviso'` | |
| 8.4 | Pin com painel do TikTok Shop aberto | Produto fixado; evento `pin_produto · ok`; rotação girando a cada N min | |

## 9. Produção — depois do deploy (push = deploy do backend)

| # | Passo | Esperado | OK |
|---|---|---|---|
| 9.1 | Log de boot do backend (Hostinger) | "Tabela de preços validada" e migrations sem pendência (`migrationsRun` em produção) | |
| 9.2 | `GET /api/v1/billing/plans` (logado) em produção | Preços/perks iguais ao item 2.2/2.3 | |
| 9.3 | Site de produção (frontend estático **subido à mão**) | Landing e `/planos` iguais ao local — se não, o build do front não foi publicado | |
| 9.4 | Checkout real de pack de live 1h | Página da Stripe mostra **R$ 9,90**; webhook credita 60 min | |
| 9.5 | Desktop `dev:sim:prod` (ou build) contra produção | Itens 6.1–6.7 repetidos | |

## 10. Regressões rápidas

- `cd backend && npx tsc --noEmit && npx jest` → verde (inclui `live-duracao`, `live-prioridade`, billing).
- `cd desktop && npx tsc --noEmit && npx vitest run` → verde (54+ testes).
- `cd frontend && npx tsc --noEmit -p tsconfig.json && npx vitest run` → verde.
- `cd backend && npm run stripe:check` → "Tudo alinhado."
