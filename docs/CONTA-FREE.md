# Conta gratuita (modo amostra)

Este documento explica **o que uma conta sem assinatura enxerga do PikPok**, por que ela
enxerga exatamente isso, e o que precisa continuar verdadeiro para que a conta gratuita
não volte a ser o que ela foi antes: um jeito de usar o produto sem pagar.

Fonte da verdade do que está aqui: `backend/src/modules/free/` (a API da amostra),
`backend/src/modules/billing/billing.config.ts` (limites e política de plano) e
`frontend/src/components/ui/RequireSubscription.tsx` (o que o navegador libera).
Se um número deste documento divergir do código, o código está certo.

---

## 1. Por que a conta grátis voltou

Ela tinha sido removida por um motivo correto: dado de mercado **custa dinheiro por
consulta** no fornecedor, e cada chamada de IA custa por chamada. Conta grátis com acesso
real ao ranking é prejuízo por visitante — e pior, é o próprio produto entregue de graça,
porque quem já viu a lista dos produtos que estão vendendo não precisa assinar para agir
sobre ela.

O que o paywall na entrada não resolveu foi o outro lado: um produto de descoberta se vende
mostrando o que descobriu. A [vitrine pública](../backend/src/modules/showcase/showcase.service.ts)
da landing cobre parte disso, mas ela é anônima — não cria conta, não cria hábito, e não
tem para onde converter além do botão de assinar.

A conta gratuita volta como o degrau intermediário: **a plataforma real, com uma amostra
real, pequena e congelada — e com as ferramentas de IA ligadas, limitadas por saldo.** Ela
existe para provar e para converter, não para operar.

## 1.1 A régua: o que é limitável por saldo abre; o que é ilimitável, não

Esta é a frase que decide tudo o que vem abaixo, e ela separa os dois custos do produto:

| | Dado de mercado (`discovery`) | Ferramentas de IA (`ai_*`) |
|---|---|---|
| Como custa | por consulta ao fornecedor | por chamada, e a chamada já é medida em crédito |
| Tem teto natural? | **não** | **sim: o saldo** |
| No gratuito | só a **amostra** fixa | **abertas**, com 250 créditos de cortesia + **1 cena de produto na Fábrica** pelo vídeo de cortesia (`campaigns_sample`) + **10 minutos de Live Copilot** (painel) de cortesia, exclusivos do free |

Abrir o roteiro, a análise, a transcrição e a imagem para quem não paga não abre torneira
nenhuma: o teto é o saldo, o saldo é concedido uma vez e não renova. E é o que faz a conta
gratuita valer alguma coisa — o vendedor vê o roteiro sair **com o produto dele**, que é a
única demonstração que converte. Já `discovery` não tem teto: liberá-la seria entregar o
produto.

---

## 2. A regra que sustenta tudo: a amostra é global e congelada

Um único conjunto de itens, **igual para todas as contas gratuitas**, válido por 7 dias.

Não é uma limitação de quantidade por usuário — é um conjunto fixo. A diferença é o
documento inteiro:

| | Cota por usuário ("20 consultas") | Amostra global congelada (o que fazemos) |
|---|---|---|
| Dar F5 | pode revelar itens novos | devolve exatamente os mesmos itens |
| Criar uma segunda conta | dobra o que se vê | não revela **nada** novo |
| Custo do DADO por conta nova | linear | zero |
| Anti-abuso necessário **para o dado** | detecção de multi-conta, e-mail descartável | nenhum |

Do lado do dado, portanto, não há o que ganhar burlando: a décima conta de uma mesma pessoa
vê os mesmos 20 produtos que a primeira.

**Isso vale para o dado, e não para a cortesia de créditos.** Desde que a conta gratuita
passou a receber 250 créditos de IA e um vídeo com IA de cortesia (seção 1.1), uma conta nova
vale até R$ 5,10 — e aí o incentivo a criar contas em série existe de verdade. O que segura é
cada cortesia ser concedida **uma vez por conta**, não renovar, o vídeo não entrar no saldo
(dez contas não somam dez vídeos numa campanha) e o cadastro exigir confirmação de e-mail; o
que não existe é limite por IP ou por domínio. Está descrito com números em
[Precificação, seção 8.3](PRECIFICACAO.md).

Consequência de projeto: o snapshot é **persistido em tabela**, não guardado em memória.
Um deploy no meio da semana não pode trocar a amostra — o congelamento é a promessa, e uma
promessa que o restart quebra não é promessa.

---

## 3. Os limites

| O que | Quanto | Onde |
|---|---|---|
| Produtos na amostra | 20 | `FREE_SAMPLE.products` |
| Vídeos na amostra | 10 | `FREE_SAMPLE.videos` |
| Validade do snapshot | 7 dias | `FREE_SAMPLE.refreshDays` |
| Tamanho do pool de rodízio | 6x a amostra | `FREE_SAMPLE.poolFactor` |
| Quando a janela vira | segunda, 00:00 (Brasília) | `FREE_SAMPLE.rotationAnchorUtcMs` |

Os três números moram em `billing.config.ts`, junto do resto da política comercial, e não
no módulo `free`: são decisão de negócio, e ficam onde as outras decisões de negócio já
estão sendo lidas quando alguém for mexer no funil.

**A seleção é diversificada por categoria.** Pegar o topo puro do ranking produz vinte
itens do mesmo nicho, e aí a amostra prova que a base é grande em um assunto só — que é o
contrário do que ela precisa provar.

**O rodízio é real, não é o mesmo topo toda semana.** A escolha lê um pool de
`poolFactor` vezes o tamanho da amostra (120 produtos, 60 vídeos, 30 criadores) e cada
janela recorta dele uma fatia diferente, dando a volta quando acaba. Sem isso a rotação
seria decorativa: as queries ordenam por ranking de 30 dias, que muda pouco em sete dias —
o usuário voltaria na segunda e veria a mesma vitrine. Com o pool, são ~6 semanas até a
primeira repetição, e nenhuma consulta a fornecedor: tudo sai do que a ingestão já gravou.

**A troca é por expiração, não por cron.** Existem dois jobs, mas os dois são só
aquecimento: quem decide é o `slot` calculado na requisição, e a fatia é função do `slot`
— então rodar o job atrasado, ou não rodar, dá exatamente a mesma amostra. Um produto que
depende do agendador para funcionar quebra silenciosamente no primeiro domingo em que o
agendador não rodar.

| Job | Quando | Para quê |
|---|---|---|
| `rotacaoSemanal()` | `0 0 * * 1` (America/Sao_Paulo) | grava o rodízio da semana no minuto da virada, para o primeiro usuário da segunda não esperar pelas queries de ranking |
| `warmUp()` | `0 4 * * *` | rede de segurança: um job semanal que falha perde a única chance da semana; este refaz em 24h |

`currentSample()` é idempotente dentro da janela, então os dois rodando não geram trabalho
extra — o segundo a rodar só lê o que já está gravado.

**Como a janela é calculada.** `slot = floor((agora − âncora) / 7 dias)`, com a âncora numa
segunda-feira 00:00 de Brasília (`Date.UTC(2024, 0, 1, 3, 0, 0)`; o Brasil não tem mais
horário de verão, então o `-03:00` fixo vale o ano inteiro). Ancorar num instante fixo faz
a troca acontecer no mesmo momento para todo mundo; alinhar à primeira geração faria a data
de rotação depender de qual visitante acordou o snapshot primeiro. A âncora não é mais a
época Unix porque a época cai numa **quinta**, e a amostra virava na madrugada de quinta —
num horário que ninguém escolheu. O `slot` é também o `UNIQUE` da tabela, e é ele que
garante que duas requisições simultâneas numa janela vazia não criem dois snapshots
concorrentes: a segunda perde a corrida no banco e lê o que a primeira gravou.

---

## 4. O que a amostra mostra — e o que ela corta

A régua é a mesma da vitrine pública: **generoso no visual, avaro no dado acionável.**

Entra:

- imagem, título e categoria do produto;
- preço;
- vendas em **faixa** ("25 mil+"), nunca o número exato;
- crescimento no período, arredondado;
- nos vídeos: capa, métricas em faixa e link para o original no TikTok.

Fica de fora, e cada corte tem um motivo:

| Cortado | Por quê |
|---|---|
| Nome da loja e link de compra | é literalmente o que se paga para saber: onde comprar |
| Receita exata e número exato de vendas | é a planilha; a faixa dá a ordem de grandeza sem virar ferramenta |
| Série diária | é a leitura de tendência, o motivo de voltar todo dia |
| Playback de vídeo | banda e proxy nossos, gastos por quem não paga; o link para o TikTok resolve |
| Filtros, busca, ordenação, paginação, período | **parâmetro é o que transforma amostra em ferramenta** |

Esse último item é o mais fácil de erodir por engano. As rotas do modo amostra **não aceitam
nenhum parâmetro de consulta**. No dia em que aceitarem `search`, a conta gratuita deixa de
ser uma vitrine e passa a ser um buscador de mercado grátis — sem que ninguém tenha decidido
isso, e sem que o limite de 20 mude uma linha.

---

## 5. Como a trava é implementada

### 5.1 API separada

`FREE_MODE` não é uma feature de plano. `FEATURE_MIN_PLAN` continua com **tudo em
`essencial` ou acima** — nada foi afrouxado lá. Os controllers reais de produtos e vídeos
seguem inteiros sob `@RequiresPlanFeature('discovery')`.

A amostra vive num módulo próprio, `backend/src/modules/free/`, com rotas próprias:

```
GET /free/sample          → { products[], videos[], refreshAt, limits }
GET /free/products/:id    → detalhe reduzido
GET /free/videos/:id      → detalhe reduzido
```

Autenticadas (é conta criada, não visitante), mas fora do `PlanFeatureGuard`.

**Por que módulo separado e não um `if` dentro de `ProductsService`.** Um ramo condicional
dentro do serviço pago faz o caminho gratuito e o pago compartilharem a construção da
resposta — e a partir daí todo campo novo adicionado ao produto vaza para o free por
omissão, porque ninguém lembrou de cortá-lo. Com um módulo separado, o padrão de falha se
inverte: o campo novo **não** aparece no free até alguém escrevê-lo lá de propósito.

### 5.2 Pertencimento ao snapshot

O detalhe responde **403 se o id não estiver na amostra vigente**.

Sem essa checagem o limite de 20 é decorativo: bastaria descobrir um id qualquer (a vitrine
pública já expõe alguns) e o detalhe viraria consulta ilimitada. O limite não está na lista
— está no conjunto de ids que o detalhe aceita.

### 5.3 Rate limit

As rotas do free têm limite de requisição próprio. Não é defesa contra abuso de dado (não
há dado novo para extrair), é defesa de infraestrutura: são as únicas rotas autenticadas que
uma conta que nunca pagou consegue chamar.

### 5.4 Quem paga não passa por aqui

Conta com plano ativo que bater em `/free/*` não recebe a versão reduzida como se fosse a
boa. A rota gratuita não pode virar um atalho barato usado por engano pelo front do
assinante — o dia em que virar, um bug de UI degrada silenciosamente o produto de quem
pagou.

---

## 6. O que abre e o que não abre

**Abre** (mínimo `free` em `FEATURE_MIN_PLAN`, limitado pelo saldo): roteiros com IA,
análise de vídeo viral, transcrição, imagens com IA, gerador local do estúdio, upload de
arquivo do próprio vendedor e o **Live Copilot no modo painel** (`live_copilot = 'free'`),
limitado pelos 10 minutos de cortesia — que são exclusivos do free: quem assina entra com as
horas de adesão do plano e não ganha cortesia. Acabou, é 402 com o CTA de assinar.

**Não abre:** o dado de mercado completo (`discovery` — ranking, busca, filtros, tendências,
criadores, favoritos), vídeos com IA, multiplicador, campanhas, o **envio automático** do Live
Copilot (Business, travado em `trocarModo`) e coleta. Os quatro últimos porque são de planos
acima do Essencial; `discovery` porque não tem teto (seção 1.1).

A régua para features futuras: **pergunte se o recurso tem teto de saldo.** Se tiver, pode
descer para `free` em `FEATURE_MIN_PLAN`. Se não tiver — qualquer coisa que consulte
fornecedor por item, ou que dependa de volume — o lugar dela é o piso pago, e o que se
oferece ao gratuito é uma amostra fixa, como a de produtos e vídeos. Herdar `essencial` da
linha de cima sem responder essa pergunta é como um custo sem teto entra no gratuito sem
ninguém decidir. O teste `abre no gratuito exatamente o que o crédito limita`
(`billing.config.spec.ts`) lista os recursos um a um justamente para forçar a resposta.

---

## 7. Quem cai no modo amostra

Qualquer conta sem assinatura ativa: **cadastro novo e assinatura encerrada**, no mesmo
estado `plan: 'free'`.

Não distinguimos "nunca pagou" de "já pagou e saiu". Distinguir custaria uma coluna e um
estado a mais para produzir o pior resultado dos dois: quem cancela bateria numa porta
fechada, enquanto quem nunca pagou vê a plataforma. O churn é justamente quem já conhece o
valor — é o público que mais merece continuar vendo a vitrine.

---

## 8. Na interface, a limitação é dita

Uma conta gratuita que não sabe que é gratuita não faz upgrade — ela conclui que o produto
é pequeno.

- **Banner fixo** no topo das telas de descoberta: "Conta gratuita — amostra de 20 produtos,
  atualiza em N dias", com o caminho para assinar.
- **Cards bloqueados ao fim da lista**, com o tamanho real da base ("+X mil produtos no
  plano Essencial"). O número vem das estatísticas que a vitrine já calcula.
- **Itens travados aparecem no menu com cadeado** (`PlanGate`), não somem. Recurso invisível
  não vende degrau nenhum.
- **Filtros e busca são renderizados desabilitados**, com o motivo no tooltip — não são
  removidos. A ausência lê como produto incompleto; o cadeado lê como plano.

`getWallet` passa a devolver um bloco `freeSample` (`active`, `products`, `videos`,
`refreshAt`) porque o front precisa distinguir **"sem acesso"** de **"acesso em amostra"** —
são duas telas diferentes, e hoje ele só sabe responder a primeira.

`RequireSubscription` deixa de ser tudo-ou-nada. As três telas de descoberta (`/produtos`,
`/produtos/:id`, `/videos`) saíram de dentro dele e passaram a ser decididas pelo
`FreeSampleGate`, que escolhe entre a versão paga e a amostra. Todo o resto continua atrás
do paywall.

**Mudou também para onde a conta gratuita é mandada.** Antes, toda rota paga jogava para
`/assinatura`. Agora joga para `/produtos` quando a conta tem amostra: é a única porta que
ela pode abrir, e mandá-la ao checkout a cada clique transformaria o app inteiro num pedido
de dinheiro. A tela de assinatura fica a um clique, em todo CTA da amostra. Sem amostra
(backend antigo, estado desconhecido), o destino continua sendo `/assinatura`.

O detalhe de um produto fora da amostra vira **tela de upgrade, não erro**: quem chegou por
um link antigo bateu no limite do plano, não num bug, e a tela nomeia o que falta (loja,
números exatos, série diária, criadores, IA) em vez de dizer "assine para ver mais".

### 8.1 O gasto é dito antes, durante e no fim

Caso de 2026-08-24: uma conta free gastou os 250 créditos em três roteiros iguais em 72 s e
só percebeu no 402. O saldo estava no cabeçalho o tempo todo — um número que ninguém mandou
olhar é invisível. Regras (valem para todo plano; a free é onde doem):

- **Preço no botão.** "Gerar roteiro de live · 8 créditos" no Estúdio, como já era na Fábrica.
- **Confirmação sem atalho na free.** O diálogo de gasto (`useConfirmarGasto`) esconde o
  "não perguntar de novo nesta sessão" quando `plan === 'free'` — 250 créditos são trinta
  cliques; dispensar o aviso ali é como se gasta tudo sem ver.
- **Regerar é uma escolha.** Se existe roteiro do mesmo produto e tipo nos últimos 30 min, o
  Estúdio mostra "você gerou um roteiro deste produto há N min; gerar outro custa +8; editar
  o que existe não custa nada".
- **Consumo do ciclo no cabeçalho.** `getWallet.consumo` = `{ concedidos, usados,
  restantes, percentual, desde }`, ciclo ancorado no último `plan_grant`/`signup_bonus`
  (pacote avulso e ajuste do suporte não reiniciam o ciclo — fazem a barra recuar). O chip
  de créditos tem barra fina de progresso e muda de cor: rosa até 49%, âmbar de 50 a 99%,
  vermelho ("créditos esgotados") em 100%. Tooltip diz "usou X de Y (N%)".
- **Aviso em 50 / 75 / 100 %** (`ConsumoToast`): um por marco, por ciclo (localStorage
  por e-mail + `desde`). Tom de informação, não de bronca — 50% diz quantos roteiros ainda
  cabem; 75% lembra que editar é grátis; 100% diz que tudo o que foi gerado continua salvo e
  aponta o plano (free) ou a recarga (pago). Só o de 100% fica até ser fechado.
- **O resultado aparece antes do próximo clique.** No Estúdio, o roteiro gerado rola para a
  tela (`scrollIntoView`) e o botão vira secundário com "Gerar outro roteiro · 8 créditos".
- **Preço em todo botão que cobra**: Analisar (12), Montar vídeos (N × 1), Gerar cortes
  (total do orçamento). Conta ilimitada não vê preço.
- **402 vem com saída.** O erro de saldo no Estúdio traz o botão "Assinar um plano" /
  "Comprar créditos" e reconsulta a carteira para travar o botão principal.
- **Boas-vindas dizem o que os créditos compram**: "cada roteiro custa 8 — dão para 3",
  calculado da tabela de preços, e que editar um roteiro pronto é grátis.
- **Extrato diz onde gastou**: o débito de roteiro leva o nome do produto ("Roteiro com IA —
  Liquidificador Mondial"), via o parâmetro `detalhe` de `withCharge`/`charge`.
- **/planos mostra o ciclo**: barra "usou X de Y neste ciclo (N%)" sob o saldo.
- **Recarga é boa notícia**: quando o saldo sobe em relação ao último visto (localStorage por
  e-mail), o `ConsumoToast` mostra "Você recebeu N créditos. Saldo atual: X" — inclusive se o
  crédito entrou com a pessoa offline (caso do ajuste do suporte).

---

## 9. O que os testes travam

| Teste | O que ele impede de voltar |
|---|---|
| Duas chamadas seguidas devolvem o mesmo conjunto | o F5 que revela item novo |
| Detalhe de id fora da amostra → 403 | o limite decorativo da seção 5.2 |
| Conta free em qualquer rota de IA → 403 | o vazamento pelo `FEATURE_MIN_PLAN` |
| Quantidades = 20 e 10 | o limite que cresce sem decisão |
| Snapshot expirado gera um novo | a amostra que congela para sempre |
| Duas gerações concorrentes convergem | contas vendo amostras diferentes na mesma semana |
| O card não tem `storeName`, `tiktokUrl`, `revenue`, `playbackUrl`, `transcript` | o campo novo que vaza por omissão |
| `FreeSampleService` recebe só repositórios | o dia em que alguém injetar o fornecedor aqui e a conta gratuita voltar a custar por visita |
| Plano pago é barrado em `/free/*` | a rota reduzida degradando em silêncio o produto de quem pagou |

Onde: `backend/src/modules/free/free-sample.service.spec.ts` e `free-plan.guard.spec.ts`.
A trava contra rota de IA já é coberta pelos testes de `PlanFeatureGuard`/`assertFeature`,
que não mudaram — o modo amostra é aditivo e não tocou em `FEATURE_MIN_PLAN`.

---

## 10. Documentos vizinhos

- [Precificação](PRECIFICACAO.md) — de onde vem cada valor cobrado, e por que os planos
  reprovam no boot quando alguém mexe na tabela.
- [Arquitetura](ARCHITECTURE.md) — organização dos módulos e padrões de reuso.
- `backend/src/modules/showcase/showcase.service.ts` — a vitrine pública anônima, um degrau
  abaixo desta.
