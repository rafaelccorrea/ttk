# Precificação

Este documento explica **de onde vem cada valor cobrado pelo PikPok** e **como saber se
esses valores ainda se sustentam**. Todos os números aqui saem de código: a fonte da verdade
é `backend/src/modules/billing/billing.config.ts` (tabela de preços) e
`backend/src/modules/telemetry/model-pricing.ts` (preço de tabela dos fornecedores).
Se um número deste documento divergir do código, o código está certo e o documento está velho.

---

## 1. As duas moedas

O PikPok cobra em duas moedas que **não se convertem uma na outra**.

| Moeda | Campo | O que compra | Onde é vendida |
|---|---|---|---|
| Crédito de IA | `app_users.credits` | Roteiro, análise, transcrição, imagem, vídeo, montagem do Multiplicador, extração da base de conhecimento de uma live gravada | Cota mensal/anual do plano + `CREDIT_PACKS` |
| Minuto de live | `app_users.liveMinutes` | Tempo de copiloto ao vivo conectado ao chat da transmissão | Add-ons `LIVE_HOUR_PACKS` (exclusivos do Business) + 10 min de cortesia |

**Por que separadas.** Crédito é uma unidade de *trabalho pedido item a item*: um roteiro, uma
imagem, uma transcrição. São coisas discretas, que o vendedor solicita uma a uma e cujo preço
ele compara antes de clicar. Live não é discreta — ele liga o copiloto no início da transmissão
e desliga no fim. A pergunta que ele faz antes de começar é "quantas horas eu ainda tenho",
não "quantos créditos isso vai queimar por minuto". Misturar as duas transforma cada live num
cálculo mental e faz o vendedor hesitar em deixar o copiloto ligado, que é exatamente o
comportamento que mata o produto.

Há também um efeito de proteção: uma live de três horas não pode consumir a cota que o vendedor
reservou para produzir criativos no mês. São orçamentos separados porque são decisões separadas.

**Por que não se convertem.** Não existe câmbio interno crédito↔minuto, e isso é deliberado.
No momento em que existisse, a hora de live passaria a competir por preço com o vídeo com IA,
e o teste `assertProfitability()` teria de reconciliar duas curvas de custo com naturezas
diferentes (custo por chamada × custo por tempo de conexão). O teste
`não cobra o copiloto ao vivo em créditos de IA` em `billing.config.spec.ts` trava isso:
qualquer ação `live_*` nova criada dentro de `ACTION_PRICES` (fora `live_extract`) quebra o CI.

---

## 2. Como um preço nasce

Três constantes governam tudo:

| Constante | Valor | Onde |
|---|---|---|
| `CREDIT_VALUE_BRL` | R$ 0,10 por crédito (valor de face) | `billing.config.ts` |
| `USD_BRL` | 6,00 (câmbio conservador) | `model-pricing.ts` |
| `MIN_MARGIN` | 1,4 (40% sobre o custo de pior caso) | `billing.config.ts` |

A receita para precificar uma ação nova:

1. Calcule o **custo de pior caso em BRL** (`worstCaseCostBrl`): o cenário mais caro plausível
   — prompt cheio, saída no teto, cache não pegando —, convertido a US$ 1 = R$ 6,00.
2. Escolha um número de créditos tal que `credits × 0,10 >= worstCaseCostBrl × 1,4`.
3. **Antes de aceitar**, verifique `worstCaseCostBrl / credits <= 0,06` (ver seção 3).
4. Deixe o boot conferir.

**`assertProfitability()` é o cinto de segurança de boot.** Ele roda na subida do servidor e
devolve a lista de problemas; se a lista não estiver vazia, o servidor **se recusa a subir**.
Ele confere, com a mesma margem de 1,4:

- cada ação de `ACTION_PRICES`, contra o próprio custo;
- cada plano, **em cada ciclo** (mensal e anual são checados com os próprios números — o anual
  não é o mensal × 12, é uma cota própria), contra `créditos × piorCustoPorCrédito`;
- cada pacote de crédito, pela mesma conta;
- cada add-on de hora de live, contra `minutos × LIVE_COST_PER_MINUTE_BRL`.

O mesmo `assertProfitability()` está travado em teste
(`mantém todas as margens acima do mínimo`), então a quebra aparece no CI antes de aparecer no
boot de produção.

---

## 3. A armadilha do `worstCostPerCredit`

**Esta é a seção que mais gente erra.** Leia antes de mexer em `ACTION_PRICES`.

```ts
export function worstCostPerCredit(): number {
  return Math.max(...Object.values(ACTION_PRICES).map((a) => a.worstCaseCostBrl / a.credits));
}
```

O pior custo **por crédito** de toda a tabela é um número **global**. Ele não serve só para
julgar a ação de onde veio: ele é o custo que `assertProfitability()` assume que um crédito
qualquer pode ter quando avalia **planos e pacotes** — porque o cliente pode gastar toda a cota
na ação mais cara que existir.

Consequência: **uma ação nova mal precificada não quebra só a si mesma — ela derruba os planos.**
E derruba no boot, num arquivo que ninguém editou.

Hoje o pior custo por crédito é **R$ 0,06** (vídeo: 3,60 / 60; `analyze` e `transcribe` empatam
no mesmo valor). Com a margem de 1,4, o piso de preço de um crédito em plano ou pacote é
**R$ 0,084**.

### O caso real: `live_extract` com 16 créditos

A extração da base de conhecimento de uma live gravada custa ~R$ 1,00 no pior caso (map em
`claude-sonnet-5` sobre as fatias, reduce em `claude-opus-5`). A tentação é cobrar 16 créditos:

| | 16 créditos | 17 créditos (o que está no código) |
|---|---|---|
| Face cobrada | R$ 1,60 | R$ 1,70 |
| Teste da própria ação (`>= 1,00 × 1,4 = 1,40`) | **passa** (1,60) | passa (1,70) |
| Custo por crédito | 1,00 / 16 = **R$ 0,0625** | 1,00 / 17 = R$ 0,0588 |
| Novo `worstCostPerCredit()` | **R$ 0,0625** (sobe) | R$ 0,06 (não muda — segue o vídeo) |
| Novo piso por crédito (× 1,4) | **R$ 0,0875** | R$ 0,084 |

Com o piso em R$ 0,0875, dois planos que ninguém tocou passam a reprovar no boot:

| Plano | Conta | R$/crédito | Contra o piso R$ 0,0875 |
|---|---|---|---|
| Essencial anual | 399,90 / 4.600 | R$ 0,0869 | **reprova** |
| Pro anual | 899,90 / 10.400 | R$ 0,0865 | **reprova** |
| Essencial mensal | 39,90 / 450 | R$ 0,0887 | passa (por pouco) |
| Business mensal | 249,90 / 2.800 | R$ 0,0893 | passa (por pouco) |
| Pro mensal | 89,90 / 1.000 | R$ 0,0899 | passa (por pouco) |

Os planos anuais são os primeiros a cair porque é neles que o desconto de volume já consumiu
quase toda a folga: o Pro anual roda a **1,44× o pior custo**, a 0,04 de distância do mínimo de
1,4. Não há espaço para o piso subir.

### A regra prática

> Ao adicionar ou reprecificar uma ação, cheque **`worstCaseCostBrl / credits <= 0,06`
> ANTES de checar a margem da ação.** A margem da própria ação é a condição fácil; o custo por
> crédito é a que tem efeito colateral no resto da tabela.

Se uma ação nova não couber em R$ 0,06/crédito, há duas saídas legítimas: dar mais créditos à
ação (o que está feito em `live_extract`), ou aceitar que o piso subiu e **reprecificar os planos
anuais junto**, na mesma alteração. O que não existe é subir o piso e não olhar para os planos —
o boot descobre por você, e descobre em produção.

---

## 4. Tabelas de valores

Todos os cálculos abaixo foram refeitos a partir dos números do código.

### 4.1 Ações cobradas em crédito (`ACTION_PRICES`)

Face = `créditos × R$ 0,10`. Margem = face ÷ custo. Mínimo exigido: 1,40.

| Ação | Créditos | Face (R$) | Custo pior caso (R$) | Margem | Custo/crédito (R$) |
|---|---:|---:|---:|---:|---:|
| `script` — Roteiro com IA | 8 | 0,80 | 0,39 | 2,05 | 0,0488 |
| `analyze` — Análise de vídeo viral | 12 | 1,20 | 0,72 | 1,67 | **0,0600** |
| `transcribe` — Transcrição (bloco de 10 min) | 6 | 0,60 | 0,36 | 1,67 | **0,0600** |
| `image` — Imagem com IA | 12 | 1,20 | 0,60 | 2,00 | 0,0500 |
| `video` — Vídeo com IA | 60 | 6,00 | 3,60 | 1,67 | **0,0600** |
| `assembly` — Vídeo montado (Multiplicador) | 1 | 0,10 | 0,05 | 2,00 | 0,0500 |
| `live_extract` — Base de conhecimento da live | 17 | 1,70 | 1,00 | 1,70 | 0,0588 |

Três ações empatam no teto de R$ 0,0600/crédito — é esse empate que define
`worstCostPerCredit() = 0,06`. Qualquer uma das três que fique mais cara sem ganhar créditos
move o piso de todos os planos.

`transcribe` é a única ação cujo custo real varia com a entrada, e por isso é cobrada **por bloco
de 10 minutos começado** (`transcribeBlocks()`), não por arquivo. O preço fixo antigo presumia
"25 MB ≈ 20 min" e era falso: 25 MB a 64 kbps são ~52 minutos, que custavam R$ 1,88 e rendiam
R$ 1,20 — prejuízo. Teto de sanidade: `TRANSCRIBE_MAX_MINUTES = 300`.

### 4.2 Planos (`PLANS` e `LEGACY_PLANS`)

Piso com a margem mínima: R$ 0,084 por crédito.

| Plano | Ciclo | Preço (R$) | Créditos | R$/crédito | Margem sobre o pior custo |
|---|---|---:|---:|---:|---:|
| Essencial | mensal | 39,90 | 450 | 0,0887 | 1,48× |
| Essencial | anual | 399,90 | 4.600 | 0,0869 | 1,45× |
| Pro | mensal | 89,90 | 1.000 | 0,0899 | 1,50× |
| Pro | anual | 899,90 | 10.400 | 0,0865 | **1,44×** |
| Business | mensal | 249,90 | 2.800 | 0,0893 | 1,49× |
| Starter (legado) | mensal | 49,90 | 500 | 0,0998 | 1,66× |

O Pro anual é o item de menor folga da tabela inteira. Trate-o como o canário: qualquer mudança
de custo que ameace 1,4 aparece nele primeiro.

O Starter saiu do catálogo mas continua em `LEGACY_PLANS` e é checado pelo `assertProfitability()`
como qualquer outro — ele existe só para a renovação de quem assinou antes continuar creditando.

Os planos não se diferenciam só por cota; cada degrau destrava recurso (`FEATURE_MIN_PLAN`):
Essencial abre descoberta, roteiro, análise, transcrição, imagens e uploads; Pro abre vídeo com IA,
Multiplicador e campanhas; Business abre coleta e Live Copilot. Isso está travado em teste
(`vende três degraus, e cada um destrava algo novo`). **Nada começa no `free`** — `free` não é um
plano vendável, é o estado "conta criada, pagamento pendente", com rank 0 e nenhum recurso.
`SIGNUP_BONUS_CREDITS = 0` pelo mesmo motivo.

### 4.3 Pacotes avulsos (`CREDIT_PACKS`)

Sempre mais caros por crédito que os planos — é o que incentiva assinar.

| Pacote | Créditos | Preço (R$) | R$/crédito | Pior gasto (R$) | Margem |
|---|---:|---:|---:|---:|---:|
| `pack-100` | 100 | 14,90 | 0,1490 | 6,00 | 2,48× |
| `pack-300` | 300 | 39,90 | 0,1330 | 18,00 | 2,22× |
| `pack-1000` | 1.000 | 119,90 | 0,1199 | 60,00 | 2,00× |

Note que o pior pacote (R$ 0,1199/cr) ainda é 33% mais caro que o melhor plano (R$ 0,0865/cr).

### 4.4 Add-ons de hora de live (`LIVE_HOUR_PACKS`)

Custo de referência: `LIVE_COST_PER_MINUTE_BRL = 0,043` → `liveCostPerHourBrl() = R$ 2,58`.

| Pacote | Horas | Minutos | Preço (R$) | R$/hora | Custo pior caso (R$) | Margem |
|---|---:|---:|---:|---:|---:|---:|
| `live-5h` | 5 | 300 | 49,90 | 9,98 | 12,90 | 3,87× |
| `live-15h` | 15 | 900 | 129,90 | 8,66 | 38,70 | 3,36× |
| `live-40h` | 40 | 2.400 | 299,90 | 7,50 | 103,20 | 2,91× |

A margem é bem maior que a dos créditos, e não por ganância: o custo de IA é só uma parte do que
uma hora de copiloto consome. É uma hora em que a nossa infraestrutura fica conectada ao chat de
alguém, gerando resposta em nome dele, com o suporte que isso implica quando algo dá errado ao vivo.

Dois testes travam a escada: nenhum pacote pode ser vendido abaixo de custo × 1,4, e
**pacote maior nunca pode sair mais caro por hora** que um menor.

---

## 5. O Live Copilot

### Por que é exclusivo do Business

`FEATURE_MIN_PLAN.live_copilot = 'business'`. **Não é preço, é risco.** Pelo custo, o copiloto
caberia num degrau mais baixo — é mais barato que vídeo com IA. Mas é o único lugar do produto
onde escrevemos, **em nome do vendedor, dentro da plataforma dele**, com a conta dele exposta ao
que o TikTok pensa de automação. Quem usa isso precisa de suporte de gente, não de um checkout de
autoatendimento, e o Business é o único degrau que já vem com onboarding dedicado.

Isso também dá sentido à cortesia: dez minutos grátis só existem porque quem chega ali já é
assinante do topo, não visitante.

Na Fase 1 o copiloto opera em **modo somente-painel** — a resposta aparece para o streamer copiar
ou falar, e nada é enviado ao chat do TikTok. A exclusividade do Business já vale assim, porque a
restrição existe pelo destino do produto, não pelo estado atual dele. O perk publicado no plano
menciona só a base de conhecimento da live gravada, que é o que existe para o cliente hoje —
perk é promessa de venda, não de roadmap.

### A cortesia de 10 minutos

`LIVE_TRIAL_MINUTES = 10`, concedida por `grantLiveTrial(userId)`, **uma vez por conta**.

- Dez minutos é tempo de ver a coisa respondendo o próprio chat de verdade — a única demonstração
  que convence — e curto demais para substituir uma live de trabalho.
- A concessão é por **conta**, não por base de conhecimento nem por transmissão. Em qualquer outro
  recorte bastaria abrir uma base nova (ou reconectar) a cada dez minutos para nunca pagar.
- Entra no **mesmo saldo** das horas compradas, então o consumo não precisa saber se está gastando
  cortesia ou hora paga. A cortesia some sozinha quando acaba.
- Custo por conta: 10 × R$ 0,043 = **R$ 0,43**. Travado em teste como "menos de um real por conta".

### Composição do custo de R$ 0,043/minuto

Por minuto, com o **teto de 4 respostas/minuto** que o motor aplica:

| Componente | Conta | R$/min |
|---|---|---:|
| Respostas em `claude-haiku-4-5` | 4 × (1,5k entrada em cache + 120 saída) ≈ 4 × US$ 0,00075 ≈ US$ 0,003 | 0,018 |
| Reprocessamento em `claude-opus-5` da faixa cinzenta (~10% das respostas) | é onde o custo de verdade mora | 0,024 |
| Fatia da escrita do cache da base (TTL de 1 h) | | 0,001 |
| **Total** | | **0,043** |

Ou R$ 2,58 por hora cheia. Repare que **mais da metade do custo é o reprocessamento em Opus** da
faixa de baixa confiança — a alavanca de custo do copiloto não é o volume de chat, é a fração de
respostas que precisa do modelo caro.

---

## 6. Como medir se os preços se sustentam

Toda a tabela acima é feita de **estimativas de pior caso calculadas à mão**. E estimativa à mão
**envelhece calada**: o fornecedor reajusta, o prompt engorda numa PR que ninguém associou a custo,
o cache pega menos do que se supunha. Sem medição, a primeira notícia de que a margem virou
prejuízo é a fatura.

### 6.1 `ai_cost_events` — o contraditório da tabela de preços

Cada chamada de IA grava uma linha (`AiCostService.registrar()` / `registrarTranscricao()`):

| Campo | O que guarda |
|---|---|
| `feature` | `script`, `campaign`, `analyze`, `transcribe`, `live_extract`, `live_reply` — a chave do relatório: margem se apura **por recurso vendido**, não por modelo nem por usuário |
| `model` | o modelo exato que atendeu |
| `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` | o uso reportado pela própria API |
| `audioSeconds` | segundos de áudio, quando é transcrição (Whisper cobra por minuto) |
| `costBrl` | custo em BRL pela tabela vigente no momento |
| `chargedUnit` / `chargedAmount` | em que moeda e quanto o cliente pagou (`credit`, `live_minute`, `none`) |
| `userId` | nulo em rotina interna — nem toda chamada tem dono |

**Por que guarda tokens e não só reais.** O preço do fornecedor muda. Com os tokens gravados, o
histórico inteiro pode ser **reapurado** com a tabela nova — dá para responder "quanto o ano passado
teria custado no preço de hoje". Com o valor fechado em reais, não dá: o passado fica congelado numa
tabela de preços que já não existe.

**Por que guarda `chargedUnit`/`chargedAmount` na própria linha.** Sem eles, cruzar custo com receita
depois viraria adivinhação sobre qual tabela de preços valia naquele dia.

A gravação é **best-effort e engole o próprio erro**: perder uma linha de telemetria é um relatório
levemente subestimado; derrubar a geração de um roteiro porque a telemetria falhou é perder o produto
para salvar a métrica. Toda chamada ao Claude passa pelo wrapper privado
`AiService.chamar(feature, params, meta)`, que é quem registra — chamar `client.messages.create`
direto significa custo que não aparece em relatório nenhum.

### 6.2 `GET /api/v1/admin/margem?dias=30`

Fica no admin, não no painel do cliente, por motivo óbvio: é o nosso custo.

```jsonc
{
  "periodo": { "desde": "...", "ate": "...", "dias": 30 },
  "margemMinima": 1.4,
  "total": { "custoBrl": 0, "receitaBrl": 0, "margem": null },
  "porRecurso": [
    { "feature": "script", "chamadas": 0, "custoBrl": 0,
      "receitaBrl": 0, "margem": null, "custoMedioBrl": 0 }
  ],
  "alertas": [
    { "feature": "live_reply", "piorCasoMedidoBrl": 0, "estimadoBrl": 0.043 }
  ]
}
```

| Campo | Significado |
|---|---|
| `margemMinima` | 1,4 — a régua contra a qual tudo é lido, vinda de `MIN_MARGIN` |
| `total.custoBrl` | soma do que a IA custou de verdade no período |
| `total.receitaBrl` | receita **reconstruída da moeda cobrada**: créditos × R$ 0,10 + minutos × preço do minuto |
| `total.margem` | receita ÷ custo. **`null` quando não houve custo medido** — devolver 0 ou infinito ali viraria "está tudo bem", que é a leitura errada |
| `porRecurso[].chamadas` | quantas chamadas daquele recurso |
| `porRecurso[].custoMedioBrl` | custo médio por chamada, 4 casas — o número que se compara com o `worstCaseCostBrl` da tabela |
| `alertas` | recursos cujo custo **medido** já passou do **estimado** |

O preço do minuto usado na receita de live é o do pacote **mais barato por hora** (hoje `live-40h`:
299,90 ÷ 2.400 = R$ 0,1250/min). É a leitura conservadora de propósito: subestima a receita, nunca
o contrário.

### 6.3 Como ler os `alertas`

`acoesAcimaDoEstimado()` compara o `MAX(costBrl)` observado no período com o custo precificado —
`ACTION_PRICES[feature].worstCaseCostBrl` para as ações em crédito, e `LIVE_COST_PER_MINUTE_BRL`
para `live_reply`, que é precificado **por minuto** e não por chamada.

Um item em `alertas` significa: **o "pior caso" que escrevemos à mão já foi ultrapassado pela
realidade.** O preço parou de refletir o custo, e a margem está sendo corroída em silêncio —
com a fatura chegando depois. Lista vazia é o estado saudável.

Cuidado com o alerta de `live_reply`: o estimado ali é o custo de um **minuto** e o medido é o de
uma **chamada**. Uma chamada individual passar de R$ 0,043 não é necessariamente prejuízo (cabem 4
respostas por minuto no teto), mas é sinal de que a decomposição do custo por minuto precisa ser
refeita com dado real.

### 6.4 Rotina de acompanhamento

| Frequência | O que olhar | Gatilho | Ação |
|---|---|---|---|
| Semanal | `alertas` em `?dias=7` | lista não vazia | Refazer o preço da ação: recalcular `worstCaseCostBrl` com o custo medido, e **antes de fechar, checar `worstCaseCostBrl/credits <= 0,06`** (seção 3). Se o piso subir, reprecificar os planos anuais na mesma alteração |
| Semanal | `porRecurso[].custoMedioBrl` de `live_reply` | subindo sem mudança de produto | Investigar a fração de reprocessamento em Opus — é mais da metade do custo do minuto |
| Semanal | `cacheReadTokens` de `live_reply` | **zerado ou caindo** | O prompt está sendo invalidado: algo variável entrou no prefixo cacheado (timestamp, contador, ordem instável de itens da base). O custo por minuto vai a múltiplos do estimado sem que nenhum alerta por chamada dispare cedo |
| Mensal | `total.margem` em `?dias=30` | **< 1,4** | Parar e revisar a tabela inteira. Este é o mesmo número que o `assertProfitability()` exige na estimativa — se o realizado não alcança, a estimativa está errada, não o mundo |
| Mensal | `porRecurso[].margem` por recurso | qualquer recurso < 1,4 com o total acima de 1,4 | Um recurso está sendo subsidiado pelos outros. Decida explicitamente se é subsídio intencional (ex.: `assembly`, barato de propósito) ou erro de preço |
| A cada mudança de modelo ou de prompt | `custoMedioBrl` do recurso afetado, antes e depois | variação > 20% | Reprecificar antes de a mudança chegar a volume |
| A cada reajuste de fornecedor | `MODEL_PRICING` + reapuração do histórico pelos tokens | qualquer | Atualizar a tabela e **reapurar** o período recente com os preços novos para ver a margem que teríamos tido |

Duas travas silenciosas que valem lembrar: `FALLBACK_PRICING` cobra caro (US$ 5/25 por MTok) para
que um modelo novo não passado por `MODEL_PRICING` **apareça no topo da lista de custos** em vez de
sumir do relatório; e `USD_BRL` é o mesmo nos dois arquivos de propósito — se divergirem, a margem
medida deixa de falar da margem precificada.

---

## 7. Riscos conhecidos da precificação

Honestamente, os três pontos onde esta tabela pode furar:

**1. O custo do copiloto ao vivo nunca foi medido em produção.** Os R$ 0,043/minuto foram
decompostos à mão *antes de a feature existir*. As três premissas embutidas — 4 respostas/min como
teto efetivo, ~10% de reprocessamento em Opus, cache da base pegando com TTL de 1 h — são todas
estimativas. A margem dos add-ons (2,9× a 3,9×) é folgada o bastante para absorver um erro razoável,
mas **um erro de ordem de grandeza na fração de Opus come essa folga**. É o primeiro número a
substituir por dado real assim que houver volume: veja `porRecurso.live_reply.custoMedioBrl`.

**2. O câmbio é fixo no código e o real se move.** `USD_BRL = 6,0` é conservador hoje, não é
conservador para sempre. Todos os custos em BRL da tabela — que são custos em USD convertidos —
escalam linearmente com ele. Um real a R$ 7,20/US$ (+20%) empurra o pior custo por crédito de
R$ 0,06 para R$ 0,072, o piso de R$ 0,084 para R$ 0,1008, e **reprova todos os planos no boot**.
Não há mecanismo automático: é revisão manual da constante, e nesse dia a revisão dos preços vem
junto, obrigatoriamente.

**3. O teto de respostas por minuto é o que segura o pior caso da live.** Não é uma otimização, é
a premissa que faz o preço fechar. O custo por minuto do copiloto é linear no número de respostas
geradas; se alguém afrouxar esse teto — para "melhorar a experiência", para responder mais chat, por
configuração de cliente — **o preço para de fechar** e o `assertProfitability()` não vai perceber,
porque `LIVE_COST_PER_MINUTE_BRL` é uma constante escrita à mão, não um valor derivado do teto.
Quem mexer no teto tem de mexer nessa constante na mesma alteração.

Um quarto risco menor, mas real: três ações empatam no teto de R$ 0,06/crédito e dois planos anuais
rodam a 1,44–1,45×. **A tabela tem pouca folga por construção** — o desconto de volume já foi todo
gasto. Não há espaço para absorver aumento de custo sem mexer em preço.
