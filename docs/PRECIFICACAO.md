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
| Crédito de IA | `app_users.credits` | Roteiro, análise, transcrição, imagem, vídeo, montagem do Multiplicador, cortes de vídeo longo (rápido/inteligente), extração da base de conhecimento de uma live gravada | Cota mensal/anual do plano + `CREDIT_PACKS` |
| Minuto de live | `app_users.liveMinutes` | Tempo de copiloto ao vivo conectado ao chat da transmissão | Bônus único de adesão do plano (`signupLiveHours`) + add-ons `LIVE_HOUR_PACKS` (para qualquer conta com a feature) + 10 min de cortesia (exclusivos da conta free) |

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
| `cut` — Corte rápido (Cortes, sem IA) | 2 | 0,20 | 0,10 | 2,00 | 0,0500 |
| `cut_ai` — Corte inteligente (Cortes, IA escolhe + título/gancho; Whisper cobrado à parte em `transcribe`) | 6 | 0,60 | 0,30 | 2,00 | 0,0500 |

Três ações empatam no teto de R$ 0,0600/crédito — é esse empate que define
`worstCostPerCredit() = 0,06`. Qualquer uma das três que fique mais cara sem ganhar créditos
move o piso de todos os planos.

`transcribe` é a única ação cujo custo real varia com a entrada, e por isso é cobrada **por bloco
de 10 minutos começado** (`transcribeBlocks()`), não por arquivo. O preço fixo antigo presumia
"25 MB ≈ 20 min" e era falso: 25 MB a 64 kbps são ~52 minutos, que custavam R$ 1,88 e rendiam
R$ 1,20 — prejuízo. Teto de sanidade: `TRANSCRIBE_MAX_MINUTES = 300`.

### 4.2 Planos (`PLANS` e `LEGACY_PLANS`)

Piso dos PLANOS com `PLAN_MIN_MARGIN = 0,95`: R$ 0,057 por crédito (ações e packs seguem `MIN_MARGIN = 1,4`).

> **Decisão de 2026-08-27 — cotas +45%, preço mantido.** Nenhuma assinatura desde o lançamento;
> a cota de créditos de todos os planos subiu 45% sem tocar no preço, e a cortesia do cadastro
> foi de 25 para 250. Os planos passaram a rodar em ~1,0× o pior custo (o Pro anual fica 0,5%
> abaixo no pior caso teórico). É prejuízo aceito de propósito para conquistar os primeiros
> clientes. Por isso a checagem do boot ganhou uma margem própria para planos
> (`PLAN_MIN_MARGIN = 0,95`) — ela continua impedindo que o buraco cresça, mas não bloqueia esta
> decisão. As tabelas e contas abaixo que citam 1,4× para PLANOS descrevem o cenário anterior.
> Quando a base pagar, volte `PLAN_MIN_MARGIN` para 1,4 (ou suba os preços).

| Plano | Ciclo | Preço (R$) | Créditos | R$/crédito | Margem sobre o pior custo |
|---|---|---:|---:|---:|---:|
| Essencial | mensal | 39,90 | 650 | 0,0614 | 1,02× |
| Essencial | anual | 399,90 | 6.670 | 0,0600 | 1,00× |
| Pro | mensal | 89,90 | 1.450 | 0,0620 | 1,03× |
| Pro | anual | 899,90 | 15.080 | 0,0597 | **0,99×** |
| Business | mensal | 249,90 | 4.060 | 0,0616 | 1,03× |
| Business | anual | 2.499,90 | 41.760 | 0,0599 | 1,00× |
| Starter (legado) | mensal | 49,90 | 725 | 0,0688 | 1,15× |

Nenhum plano inclui hora MENSAL de live (a moeda recorrente do plano é só o crédito) — por isso
a conta de margem volta a ser preço ÷ créditos, e o teste `cobra mais caro por crédito no plano
menor` compara a escada direto.

**O que cada plano DÁ de live é um bônus ÚNICO de adesão** ("o plano vem com X horas"):
Essencial 15h, Pro 40h, Business 60h (`signupLiveHours`, concedido em `grantSignupLiveHours` no
`setPlan` — renovação não repete, upgrade concede a diferença). É custo único de aquisição
(15h ≈ R$ 38,70 / 40h ≈ R$ 103,20 / 60h ≈ R$ 154,80, uma vez por assinante) e por isso NÃO entra
em `assertProfitability`, que compara grandezas mensais. A cortesia de 10 minutos passou a ser
EXCLUSIVA da conta free (o painel abre no free; acabou a cortesia, 402 com CTA de assinar).
Freios de tempo: duração de UMA transmissão por plano (Essencial/Pro 6h, Business 24h —
`maxLiveDurationMinutes`) e bloco mínimo de `LIVE_MIN_MINUTES` (10 min) debitado na abertura.

Hora MENSAL de live, se algum plano voltar a incluir (`monthlyLiveMinutes`), entra em
`assertProfitability()` — o custo dela (`minutos × LIVE_COST_PER_MINUTE_BRL`) soma ao dos créditos
na checagem do plano. Hoje nenhum plano declara esse campo, mas a checagem fica, e a história
explica por quê: no dia em que o Business ganhou 5 horas por mês, sem essa soma o servidor teria
subido anunciando 1,49× de margem quando a real já era 1,38×. Foi essa conta que, na época,
obrigou o preço a ir de R$ 249,90 para R$ 269,90 — e a alternativa (manter o preço e cortar 200
créditos) seria um downgrade silencioso em quem já assinava. Quando as horas viraram bônus único
de adesão, o custo mensal sumiu e o preço voltou aos R$ 249,90 base (estado atual).

O Pro anual é o item de menor folga da tabela inteira. Trate-o como o canário: qualquer mudança
de custo que ameace 1,4 aparece nele primeiro.

O Starter saiu do catálogo mas continua em `LEGACY_PLANS` e é checado pelo `assertProfitability()`
como qualquer outro — ele existe só para a renovação de quem assinou antes continuar creditando.

Os planos não se diferenciam só por cota; cada degrau destrava recurso (`FEATURE_MIN_PLAN`):
Essencial abre descoberta, roteiro, análise, transcrição, imagens e uploads; Pro abre vídeo com IA,
Multiplicador e campanhas; Business abre coleta e o **envio automático** do Live Copilot. O painel
do Live Copilot (`live_copilot = 'free'`) abre em qualquer conta, inclusive na free — a trava do
envio vive em `trocarModo`, não no gate de feature. Isso está travado em teste
(`vende três degraus, e cada um destrava algo novo`). `free` não é um plano vendável, é o estado
"conta criada, pagamento pendente", com rank 0 — mas rank 0 já não significa "nenhum recurso":
as ferramentas de IA limitáveis por saldo abrem ali, com `SIGNUP_BONUS_CREDITS = 250` de cortesia
(seção 6 e [CONTA-FREE.md](CONTA-FREE.md)).

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
| `live-1h` | 1 | 60 | 9,90 | 9,90 | 2,58 | 3,84× |
| `live-5h` | 5 | 300 | 39,90 | 7,98 | 12,90 | 3,09× |
| `live-15h` | 15 | 900 | 99,90 | 6,66 | 38,70 | 2,58× |
| `live-40h` | 40 | 2.400 | 219,90 | 5,50 | 103,20 | 2,13× |

A margem é bem maior que a dos créditos, e não por ganância: o custo de IA é só uma parte do que
uma hora de copiloto consome. É uma hora em que a nossa infraestrutura fica conectada ao chat de
alguém, gerando resposta em nome dele, com o suporte que isso implica quando algo dá errado ao vivo.

Os packs valem para qualquer conta que tenha a feature (`assertFeature('live_copilot')` no
checkout — e o gate é `free`), não são exclusivos de degrau nenhum.

Dois testes travam a escada: nenhum pacote pode ser vendido abaixo de custo × 1,4, e
**pacote maior nunca pode sair mais caro por hora** que um menor.

**A avulsa de 1h é a mais cara por hora, e tem de ser.** Ela existe para um momento específico: o
saldo acabou com a live no ar e o vendedor precisa de mais uma hora *agora*, não de um pacote de
quarenta. Sem ela, a única saída no meio da transmissão é gastar R$ 39,90 de uma vez — e quem não
quer isso simplesmente desliga o copiloto no meio da venda. Se ela saísse abaixo de R$ 7,98,
cinco avulsas custariam menos que o pacote de 5h e o desconto de volume viraria pegadinha ao
contrário; é exatamente isso que o teste da escada impede.

---

## 5. O Live Copilot

### O painel abre no free; o que é exclusivo do Business é o envio automático

`FEATURE_MIN_PLAN.live_copilot = 'free'`. O copiloto em **modo painel** — a resposta aparece para o
streamer copiar ou falar, e nada é enviado ao chat do TikTok — abre para qualquer conta, inclusive
a gratuita. Pelo custo isso cabe: é mais barato que vídeo com IA e o teto é o saldo de minutos, que
é a régua de sempre (o que é limitável por saldo abre; ver CONTA-FREE.md).

O que fica no Business é o **envio automático** (`trocarModo` em `live-reply.service.ts` exige
Business para o modo `auto`). **Não é preço, é risco.** É o único lugar do produto onde escrevemos,
**em nome do vendedor, dentro da plataforma dele**, com a conta dele exposta ao que o TikTok pensa
de automação. Quem usa isso precisa de suporte de gente, não de um checkout de autoatendimento, e o
Business é o único degrau que já vem com onboarding dedicado. A trava mudou de lugar, não
desapareceu: prender o painel junto do envio era cobrar o degrau mais caro pela metade que não tem
risco.

Isso também dá sentido à cortesia: os dez minutos grátis são do **visitante free**, e só dele —
quem assina não ganha cortesia, entra com as horas de adesão do plano (15/40/60h). Acabou a
cortesia, é 402 com o CTA de assinar.

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
| Respostas no modelo "mini" | 4 × (1,5k entrada em cache + 120 saída) ≈ 4 × US$ 0,00075 ≈ US$ 0,003 | 0,018 |
| Reprocessamento no modelo maior da faixa cinzenta (~10% das respostas) | é onde o custo de verdade mora | 0,024 |
| Fatia da escrita do cache da base (TTL de 1 h) | | 0,001 |
| **Total** | | **0,043** |

Ou R$ 2,58 por hora cheia. Repare que **mais da metade do custo é o reprocessamento no modelo maior** da
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
| `feature` | `script`, `campaign`, `analyze`, `transcribe`, `live_extract`, `live_reply`, `cuts` — a chave do relatório: margem se apura **por recurso vendido**, não por modelo nem por usuário |
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
219,90 ÷ 2.400 = R$ 0,0916/min). É a leitura conservadora de propósito: subestima a receita, nunca
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
| Semanal | `porRecurso[].custoMedioBrl` de `live_reply` | subindo sem mudança de produto | Investigar a fração de reprocessamento no modelo maior — é mais da metade do custo do minuto |
| Semanal | `cacheReadTokens` de `live_reply` | **zerado ou caindo** | O prompt está sendo invalidado: algo variável entrou no prefixo cacheado (timestamp, contador, ordem instável de itens da base). O custo por minuto vai a múltiplos do estimado sem que nenhum alerta por chamada dispare cedo |
| Mensal | `total.margem` em `?dias=30` | **< 1,4** | Parar e revisar a tabela inteira. Este é o mesmo número que o `assertProfitability()` exige na estimativa — se o realizado não alcança, a estimativa está errada, não o mundo |
| Mensal | `porRecurso[].margem` por recurso | qualquer recurso < 1,4 com o total acima de 1,4 | Um recurso está sendo subsidiado pelos outros. Decida explicitamente se é subsídio intencional (ex.: `assembly`, barato de propósito) ou erro de preço |
| A cada mudança de modelo ou de prompt | `custoMedioBrl` do recurso afetado, antes e depois | variação > 20% | Reprecificar antes de a mudança chegar a volume |
| A cada reajuste de fornecedor | `MODEL_PRICING` + reapuração do histórico pelos tokens | qualquer | Atualizar a tabela e **reapurar** o período recente com os preços novos para ver a margem que teríamos tido |

Duas travas silenciosas que valem lembrar: `FALLBACK_PRICING` cobra caro (US$ 5/25 por MTok) para
que um modelo novo não passado por `MODEL_PRICING` **apareça no topo da lista de custos** em vez de
sumir do relatório; e `USD_BRL` é o mesmo nos dois arquivos de propósito — se divergirem, a margem
medida deixa de falar da margem precificada.

### 6.5 Crédito manual pelo admin — e o aviso ao cliente

O suporte concede crédito em `/admin` → ficha da conta → aba **Ações** → "Ajustar créditos"
(`POST /api/v1/admin/users/:id/credits`). O lançamento entra no extrato como `purchase` com
`Ajuste manual (<admin>): <motivo>`.

Um crédito lançado em silêncio não resolve o caso que o motivou: quem acabou de zerar o saldo
não volta para olhar a carteira. Por isso:

- **"Avisar o cliente por e-mail"** (marcado por padrão) no próprio ajuste — só dispara quando
  o valor é positivo; falha no envio fica no log e **não** desfaz o lançamento.
- **"Avisar crédito por e-mail"** (`POST /api/v1/admin/users/:id/aviso-credito`,
  `{ amount, mensagem? }`) — avulso, para crédito já lançado sem aviso ou reenvio. Não altera o
  saldo: o e-mail informa a quantidade digitada e o saldo atual da conta. `mensagem` é texto
  livre do suporte, escapado, e aparece destacado no corpo.

O template (`MailService.sendCreditGrantEmail`) sempre fecha com "como funciona": cada ação
consome créditos e o valor aparece antes de confirmar — é a orientação que faltou no caso de
2026-08-24 (conta free gastou os 25 de boas-vindas em 3 roteiros iguais em 72 s).

---

## 7. Riscos conhecidos da precificação

Honestamente, os três pontos onde esta tabela pode furar:

**1. O custo do copiloto ao vivo nunca foi medido em produção.** Os R$ 0,043/minuto foram
decompostos à mão *antes de a feature existir*. As três premissas embutidas — 4 respostas/min como
teto efetivo, ~10% de reprocessamento no modelo maior, cache da base pegando com TTL de 1 h — são todas
estimativas. A margem dos add-ons (2,1× a 3,8×) é folgada o bastante para absorver um erro razoável,
mas **um erro de ordem de grandeza na fração do modelo maior come essa folga**. É o primeiro número a
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

---

## 8. O custo da conta gratuita

Existe de novo uma conta sem assinatura ([Conta gratuita](CONTA-FREE.md)), e ela **tem
custo**. Esta seção existe para que esse custo não vire surpresa.

### 8.1 O que ela consome, e o que não consome

| Recurso | Custo por conta gratuita |
|---|---|
| Amostra de produtos e vídeos | **zero** — conjunto fixo e global, servido do que já está ingerido. Nenhuma consulta ao fornecedor |
| Minutos de live | **zero** — o copiloto é Pro+ |
| Créditos de IA | **até R$ 15,00** — a cortesia de cadastro (250 cr) |
| Vídeo com IA de cortesia | **até R$ 3,60** — um por conta, sem entrar no saldo |

A cortesia de créditos (`SIGNUP_BONUS_CREDITS = 250`) existe porque uma conta que só olha não
vira cliente: o vendedor precisa ver o roteiro sair com o produto dele. Vinte e cinco créditos
dão três roteiros — dá para conhecer, não dá para operar.

Só que roteiro, análise e imagem ele já tem em qualquer chat de IA. **O que justifica o Pro é a
cena em vídeo**, e ela custa 60 — os 25 nunca chegam lá. Subir a cortesia para 60+ resolveria
isso inflando a carteira, e crédito em saldo é alvo de multiconta: dez contas são dez saldos que
se gastam em qualquer coisa. Por isso a segunda cortesia é um **vídeo, não créditos**
(`SAMPLE_VIDEOS_PER_ACCOUNT = 1`): a ação `video` passa uma vez por conta sem debitar e sem
exigir o Pro, só no preço de tabela, para quem está abaixo do plano mínimo de vídeo (free e
Essencial). Um benefício fixo não vale nada em escala — dez contas são dez vídeos de amostra
com que ninguém opera. Trava: `sampleVideoUsedAt` no usuário, consumido por UPDATE condicional
em `charge`; geração que falha devolve o voucher (`restoreSampleVideo`), nunca 60 créditos.

**Onde o vídeo é gasto: na Fábrica de Criativos, em modo amostra** (`campaigns_sample`, free).
A conta cadastra o produto com a foto, ganha **o roteiro desse vídeo** (um por conta, lançamento
`sample_video`/`script` de valor zero — `consumirRoteiroDeCortesia`) e gera **uma cena de
produto** — a foto real dele virando vídeo — pelo voucher. Custo teto do roteiro: R$ 0,39, já
somado ao teto de aquisição do teste (R$ 5,50). Cena com
apresentador, "gerar tudo", montagem, clone e redublagem seguem `campaigns` (Pro); a regra da
cena avulsa mora em `renderizarCena`. O gerador avulso por prompt (`/videogen`) **não** usa o
voucher (`permitirCortesia = false`): um vídeo de texto genérico não é a demonstração que a
cortesia existe para dar.

### 8.2 A conta do pior caso

250 créditos × R$ 0,06 (o `worstCostPerCredit()` de hoje, seção 3) = **R$ 15,00**, mais um vídeo
a R$ 3,60 (`sampleVideoWorstCostBrl()`) e o roteiro de cortesia = **~R$ 19,00 por conta gratuita**, no cenário em que a
pessoa gasta tudo na ação mais cara que alcança e ainda usa o vídeo. Na prática é menos — um
roteiro custa 8 créditos e sai por ~R$ 0,39 —, mas o número que se planeja é o do teto.

Isso é **custo de aquisição**, não de operação: acontece uma vez por cadastro e nunca mais.
`assertProfitability()` continua sem olhar para ele, porque aqui não há preço de venda a
proteger — não é margem, é investimento. Quem trava os números são os testes
"dá a cortesia de boas-vindas, e ela cabe no custo de aquisição" e "dá um vídeo de cortesia, e
o custo de aquisição total cabe em R$ 5,10", em `billing.config.spec.ts`.

**Se `worstCostPerCredit()` ou o pior caso do vídeo subir, este custo sobe junto, em
silêncio.** Foi por isso que os testes multiplicam um pelo outro, em vez de conferir só o 25.

### 8.3 O risco que isso reabre: multiconta

Enquanto o gratuito era só a amostra, criar dez contas não dava nada a ninguém — a amostra é
a mesma para todo mundo, e essa era a defesa. **Com as cortesias, cada conta nova vale até
R$ 5,10 de IA**, e a defesa passa a ser outra. O que segura hoje:

- a cortesia de créditos é **uma vez por conta** (lançamento `signup_bonus`, conferido antes de
  conceder) e **não renova** no mês seguinte;
- o vídeo de cortesia é **um por conta** (`sampleVideoUsedAt`), não entra no saldo e só cobre o
  vídeo de tabela — não dá para juntar dez vouchers numa campanha;
- o cadastro exige **confirmação de e-mail**;
- 250 créditos e um vídeo não montam operação nenhuma: quem quer volume assina.

O que **não** existe hoje: limite por IP, por dispositivo ou por domínio de e-mail. Se a
telemetria mostrar cadastros em série, é aqui que a trava entra — e o lugar dela é o
cadastro, não o `charge`.

### 8.4 O que muda se a amostra deixar de ser fixa

A linha "zero" da tabela depende de a amostra ser um conjunto FIXO e global. No dia em que
ela for calculada por usuário, por consulta, ou aceitar parâmetro de busca, passa a custar
por conta e esta seção precisa ser refeita. `FREE_SAMPLE` e `SIGNUP_BONUS_CREDITS` moram em
`billing.config.ts` justamente para que essa decisão seja tomada lendo este arquivo.
