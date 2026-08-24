# Roteiro de QA — Live Copilot (release 23/08/2026)

Objetivo: validar, **pelo navegador** (site) e **pelo app desktop em
simulação**, as sete features da release + preços. Cada passo tem o resultado
esperado e como provar no banco quando a tela não basta.

## 0. Ambiente

| Peça | Como subir | Aponta para |
|---|---|---|
| Backend local | `cd backend && npm run start` (porta 3000) | Supabase (DATABASE_URL do `.env`) |
| Site (código novo) | `cd frontend && DEV_API_TARGET=http://localhost:3000 npx vite --port 5175` | backend local |
| Site (espelho de prod) | `npm run dev` (5173/5174, `.env` tem `DEV_API_TARGET` de prod) | produção — mostra o catálogo ANTIGO até o deploy |
| Desktop (simulação) | `cd desktop && npm run dev:sim` | backend local (`NODE_ENV=development`) |

Pré-requisitos: migrations aplicadas (`npm run migration:run`); conta da equipe
em `COMP_ACCOUNT_EMAILS` (não gasta minutos) ou uma conta free de teste.
Consulta de apoio (Node + pg, no `backend/`):

```
node -e "require('dotenv').config();const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();console.table((await c.query('SELECT id,status,\"minutesCharged\",\"messagesSeen\",\"repliesGenerated\",\"endReason\" FROM live_runs ORDER BY \"createdAt\" DESC LIMIT 3')).rows);console.table((await c.query('SELECT tipo,acao,detalhe FROM live_run_events ORDER BY \"createdAt\" DESC LIMIT 5')).rows);await c.end()})()"
```

---

## 1. Site — Planos & Créditos (`http://localhost:5175/planos`)

| # | Passo | Esperado |
|---|---|---|
| 1.1 | Abrir `/planos` logado | Essencial R$ 39,90 · **Pro R$ 99,90** · **Business R$ 299,90**; anuais 399,90 / 999,90 / 2.999,90 |
| 1.2 | Ler os perks | Essencial: "Live Copilot no painel: já começa com 15 horas de live"; Pro: "2 horas por mês (24 no anual)"; Business: "10 horas… (120 no anual)" + "Envio automático" só no Business |
| 1.3 | Bloco "Horas de Live Copilot" | Packs **9,90 / 39,90 / 99,90 / 219,90**; marcador "melhor preço/hora" no de 40h; texto cita bloco mínimo de 10 min e horas de adesão |
| 1.4 | Conta FREE (nova) | Bloco de horas visível (feature abre no free) com "10 minutos de cortesia" disponível |
| 1.5 | Conta que acabou de assinar Pro (Stripe teste) | Saldo de live = **40h** (2.400 min) no extrato como `purchase` "horas de live inclusas na adesão"; sem lançamento `trial` |
| 1.6 | Renovar a mesma assinatura (webhook de novo) | Nenhum novo lançamento de adesão |
| 1.7 | Upgrade Pro → Business | Lançamento de **+20h** (1.200 min), não 60h |

## 2. Desktop — Configurações

| # | Passo | Esperado |
|---|---|---|
| 2.1 | Abrir Configurações | Novos controles: **Bloquear espectadores**, **Rotação automática de produtos** (switch + slider 2–60 min), **Detectar avisos do TikTok** (ligado), **Encerrar a live ao detectar aviso** (desligado, com alerta) |
| 2.2 | Digitar `@teste, curioso` em Bloquear e salvar | Reabrir mostra `teste, curioso` (normalizado, sem @) |
| 2.3 | Ligar rotação com 2 min e salvar | Chip "valendo no próximo lote" |
| 2.4 | Tentar ligar "Encerrar ao detectar" com o detector desligado | Switch desabilitado |

## 3. Desktop — live simulada (cockpit)

| # | Passo | Esperado |
|---|---|---|
| 3.1 | Escolher base pronta → Conectar live | Coluna direita limpa: escalações (≤4 cards, "+N aguardando"), "fixar produto na live · N — mostrar" **recolhido**, respostas prontas, barra de status |
| 3.2 | Banco após ~1 min | Run `conectando → ativa`; extrato com **"10 minutos"** na abertura (bloco mínimo) e 1 min por batimento depois |
| 3.3 | Chat rodando ~2 min | Respostas com preço da base; `live_chat_messages.isQuestion` marcado nas perguntas; escalações nos casos de baixa confiança |
| 3.4 | Clicar "mostrar" em fixar produto → clicar um chip | Mensagem "Não encontrei este produto no painel… fixe manualmente" (esperado na simulação) e evento `pin_produto · falhou · painel_produtos` no banco |
| 3.5 | Rotação ligada (2 min) | Após 3 falhas seguidas: linha discreta "rotação automática foi pausada" na seção de produtos — **sem** faixa vermelha; eventos `pin_produto` no banco |
| 3.6 | Encerrar pelo botão do painel | Run `encerrada` com **`endReason='manual'`** (não `erro`); resumo da live na tela |
| 3.7 | Bloqueio | Com um @ do roteiro simulado bloqueado, as mensagens dele não aparecem em respostas nem em `live_chat_messages` |

## 4. Tetos de tempo (só via banco/simulação de dados)

| # | Como | Esperado |
|---|---|---|
| 4.1 | `UPDATE live_runs SET "minutesCharged"=360 WHERE id=<run ativa de conta Pro>` e esperar o próximo batimento | Run `encerrada`, `endReason='limite_duracao'`; desktop mostra "atingiu o limite de duração do plano" |
| 4.2 | Conta free com `liveMinutes=0` e cortesia já usada tenta abrir run | 402 "Suas horas de live acabaram" com CTA de assinar |

## 5. Detector de aviso e pin — com TikTok real (não simulável)

| # | Como | Esperado |
|---|---|---|
| 5.1 | Live real; forçar um banner de aviso (ou apontar `LIVE_ENVIO_SELETORES_AVISO` para um elemento existente da página, só para o teste) | Em ≤15s: envio pausado, faixa "O TikTok emitiu um aviso — envio pausado", evento `aviso_tiktok · pausado` |
| 5.2 | Mesmo cenário com "Encerrar ao detectar" ligado | Clique no botão de encerrar do TikTok + run `endReason='aviso_tiktok'` |
| 5.3 | Cascata errada de propósito | Linha em `live_selector_failures` com `context='aviso'` |
| 5.4 | Pin com painel do TikTok Shop aberto | Produto fixado; evento `pin_produto · ok` |

## 6. Regressões rápidas

- `cd backend && npx tsc --noEmit && npx jest` → verde.
- `cd desktop && npx tsc --noEmit && npx vitest run` → verde (54+ testes).
- `cd frontend && npx vitest run` → verde.
- Boot do backend não reclama de margem (`assertProfitability`).
