# Comandos — leia ANTES de rodar

Este documento existe por um motivo específico: os scripts deste repositório
**não são inofensivos**. Alguns escrevem no banco de produção, outros gastam
cota paga que não se recupera no mês, e um deles transcreve áudio com Whisper —
dinheiro real, por execução.

**A regra:** antes de executar qualquer comando desta lista, confira aqui o que
ele altera e quanto custa. Se o comando não estiver documentado, leia o código
antes — e depois documente aqui.

Legenda das colunas de risco:

- 💾 **escreve no banco**
- 💰 **custa dinheiro** (cota do fornecedor ou API paga)
- 🌐 **abre navegador** (Playwright, sessão pessoal em disco)
- ✅ **só lê**

---

## Ingestão e dados

### `npm run atualiza` 💾

Manutenção do catálogo, **sem gastar cota**. Seis etapas; as duas primeiras são
puladas sem a flag `--completo`.

| # | Etapa | O que faz | Risco |
|---|---|---|---|
| 1 | Ingestão | pulada | — |
| 2 | Top de vendas | pulada | — |
| 3 | oEmbed | busca @handle e capa no oEmbed público do TikTok para vídeos que estão só com id numérico | 💾 salva cada vídeo |
| 4 | Limpeza | faz GET em **toda** thumbnail e avatar do banco; o que responde 403 ou não é imagem tem a URL anulada | 💾 |
| 5 | Espelhamento | baixa a mídia que ainda não está no nosso bucket e sobe para o S3 | 💾 + custo de S3 |
| 6 | Deduplicação | recalcula `dedupKey` de todos os produtos e remarca `isDuplicate` | 💾 UPDATE em massa |

Demora proporcional ao tamanho do catálogo: as etapas 4 e 5 percorrem tabela
inteira, uma requisição HTTP por item.

### `npm run atualiza:completo` 💾💰🌐

Tudo acima **mais** as etapas 1 e 2, que são as caras:

**Etapa 1 — ingestão** (`IngestionService.run`):
- Creative Center via **Playwright**, com a sessão de `cc-session.json`
- Top Ads: baixa ~60 vídeos de anúncio
- **transcreve o áudio desses anúncios com Whisper** → custo na OpenAI
- camadas de produto no EchoTik (refresh, descoberta por categoria, enrich,
  backfill), dentro do orçamento de cota da execução
- busca de imagens para produtos sem foto, com pausa de 1,2s entre elas

**Etapa 2 — top de vendas** (`IngestionService.atualizarTopVendidos`):
- os 50 mais vendidos do Brasil por GMV de 30 dias, via `/echotik/product/list`
- ~10 requisições (5 páginas de 10 + assinatura das capas)
- ajustável com `--top=N`
- roda **depois** da ingestão de propósito: se a cota acabar, o que se perde
  aqui volta na próxima execução; o refresh do catálogo, não

O orçamento de cota por execução sai de `apiMonthlyBudget` dividido pelas
execuções restantes do mês — ver `openApiAllowance()`. Cota estourada não aborta
nada: as etapas 3 a 6 rodam mesmo assim.

### `npm run atualiza -- --so-top [--top=N] [--max-req=N]` 💾💰

Roda **somente** a etapa 2 e sai — nenhuma manutenção, nenhum Playwright,
nenhum Whisper. É o caminho barato de validar o passo do top ou de puxar o
ranking sem pagar o resto.

- `--top=N` quantos produtos buscar (padrão 50)
- `--max-req=N` teto duro de requisições **desta** execução, mais apertado que o
  orçamento do mês

Escreve em produção, e isso é intencional: requisição paga não se joga fora
(ver `docs/ECHOTIK.md`, seção 10). O ensaio se limita pelo volume, nunca pelo
destino. Medido em 17/08/2026: `--top=10 --max-req=5` gastou **2 requisições** e
gravou 10 produtos com a métrica do dia.

### `npx ts-node src/scripts/sondar-echotik.ts [--teto=12]` ✅

Prova que a credencial do EchoTik funciona e mede os limites, gastando o mínimo
possível (5 requisições na prática, teto duro de 12). **Não escreve nada.** É o
comando certo para testar uma chave nova — não o `atualiza:completo`.

### `npm run testar:campanhas` / `testar:campanhas:completo` 💰

O `:completo` liga a IA de verdade. O outro roda sem.

### `npm run simular:live` ✅💰

Simula uma live para exercitar o motor de respostas. Consome IA conforme o
volume simulado.

### `npm run simular:processamento-live` ✅

Atravessa o pipeline de processamento inteiro — ffmpeg, chunker, cobrança e
banco — com um MP4 sintético de duração quebrada (879,57s). Whisper e Claude são
dublados: **não consome IA**. Existe por causa do
`invalid input syntax for type integer`, que só aparecia no último passo, depois
da live inteira transcrita. Cria e apaga a própria conta descartável.

---

## Sessões de navegador

### `npm run cc:login` 🌐

Abre Chromium **visível** no Creative Center para você logar e resolver captcha
na mão. Grava `backend/cc-session.json` — é essa sessão que a ingestão usa
depois. Não é headless de propósito: existe interação humana.

### `npm run shop:login` 🌐

O mesmo para o Seller Center (`seller-br.tiktok.com`), gravando
`backend/shop-session.json`. Detecta o cookie de sessão em loop de 4s por até 10
minutos e depois confere quais áreas a conta libera.

### `npm run shop:register` 🌐

Abre a página de cadastro de seller reaproveitando a sessão acima.

> Os dois arquivos de sessão são **credenciais**: cookies pessoais em disco,
> gitignored. Tratar como senha.

---

## Banco de dados

### `npm run migration:run` 💾 · `migration:revert` 💾

Aplica ou desfaz migrations no banco apontado pelo `.env`. **Confira para qual
banco o `.env` aponta antes.**

### `npm run migration:generate -- src/database/migrations/NomeDaMigration` ✅

Só gera o arquivo, comparando entidades com o banco. Não aplica.

### `npm run seed` · `seed:videos` · `seed:creators` · `seed:test-user` 💾

Populam o banco com dados de exemplo. Não rodar em produção.

### `npm run purge:seed` 💾 · `purge:scraped` 💾

**Apagam dados.** O primeiro remove o que veio de seed; o segundo, o que veio de
scraping. Sem confirmação interativa.

### `npm run waitlist` · `waitlist:release` 💾

Gestão da lista de espera.

---

## Desenvolvimento

| Comando | O que faz | Risco |
|---|---|---|
| `npm run start:dev` | API em watch | ✅ |
| `npm run build` | compila | ✅ |
| `npm run test` | Jest | ✅ |
| `npm run lint` | ESLint com `--fix` | altera arquivos-fonte |

No `desktop/`: `npm run dev` (Electron em watch), `npm run build`
(`tsc --noEmit` + electron-vite), `npm test` (Vitest), `npm run dist` (instalador).

---

## O que a ingestão deve sempre perseguir

Independente de qual comando disparou, toda coleta tem os mesmos quatro alvos —
detalhados em `docs/ECHOTIK.md`, seção "O objetivo permanente da coleta":

1. **produtos novos** que ainda não estão no nosso banco (medir os *inéditos*,
   não o total trazido);
2. **atualizar os que já temos** — preço, nota e a métrica diária que sustenta o
   ranking;
3. **criadores** que vendem;
4. **vídeos que vendem** — criativo com venda atrelada, não vídeo qualquer.

Quem alterar as camadas da ingestão ou o orçamento de cota deve conferir que
esses quatro continuam sendo atendidos.

## Antes de rodar qualquer coisa que gaste cota

1. A pergunta dá para responder com o **arquivo bruto** que já está no banco?
   Ver `docs/ECHOTIK.md`, seção 10 — toda resposta do EchoTik fica em
   `api_raw_responses` por 90 dias, e descobrir o contrato de um endpoint por lá
   custa zero.
2. Se for só testar credencial, use a **sonda**, não a ingestão.
3. Confira para qual banco o `.env` aponta.
4. Cota do mês: `SELECT "apiRequestsUsed", "apiMonthlyBudget", "apiMonthKey" FROM ingestion_settings;`
