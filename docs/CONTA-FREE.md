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
real, pequena e congelada.** Ela existe para provar e para converter, não para operar.

---

## 2. A regra que sustenta tudo: a amostra é global e congelada

Um único conjunto de itens, **igual para todas as contas gratuitas**, válido por 7 dias.

Não é uma limitação de quantidade por usuário — é um conjunto fixo. A diferença é o
documento inteiro:

| | Cota por usuário ("20 consultas") | Amostra global congelada (o que fazemos) |
|---|---|---|
| Dar F5 | pode revelar itens novos | devolve exatamente os mesmos itens |
| Criar uma segunda conta | dobra o que se vê | não revela **nada** novo |
| Custo por conta gratuita nova | linear | zero |
| Anti-abuso necessário | detecção de multi-conta, e-mail descartável | nenhum |

É por isso que o desenho não precisa de defesa contra fraude: **não há o que ganhar
burlando.** A décima conta de uma mesma pessoa vê os mesmos 20 produtos que a primeira.

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

Os três números moram em `billing.config.ts`, junto do resto da política comercial, e não
no módulo `free`: são decisão de negócio, e ficam onde as outras decisões de negócio já
estão sendo lidas quando alguém for mexer no funil.

**A seleção é diversificada por categoria.** Pegar o topo puro do ranking produz vinte
itens do mesmo nicho, e aí a amostra prova que a base é grande em um assunto só — que é o
contrário do que ela precisa provar.

**A troca é por expiração, não por cron.** Existe um job semanal, mas ele é só aquecimento:
quem decide é o `expiresAt` lido na requisição. Se o cron cair, a amostra ainda gira. Um
produto que depende do agendador para funcionar quebra silenciosamente no primeiro
domingo em que o agendador não rodar.

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

## 6. O que a conta gratuita **não** acessa

Tudo que custa por chamada, sem exceção: roteiros, análise de vídeo viral, transcrição,
imagens, vídeos com IA, multiplicador, campanhas, Live Copilot, uploads e coleta. E também
tendências, criadores e a busca — que são dado de fornecedor.

Nada disso exigiu mudança: já era o comportamento de `plan: 'free'` em
`FEATURE_MIN_PLAN`. O modo amostra é aditivo, e é assim que ele deve continuar. **Se algum
dia uma feature precisar ser aberta ao gratuito, a mudança certa é uma rota nova no módulo
`free`, não um `free` dentro de `FEATURE_MIN_PLAN`** — o mapa é a linha de defesa que
`assertFeature` aplica em toda a API, e furá-lo em um lugar fura em todos.

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

`RequireSubscription` deixa de ser tudo-ou-nada: libera as telas de descoberta em modo
amostra e continua mandando **todas** as outras rotas para `/assinatura`.

---

## 9. O que os testes travam

| Teste | O que ele impede de voltar |
|---|---|
| Duas chamadas seguidas devolvem o mesmo conjunto | o F5 que revela item novo |
| Detalhe de id fora da amostra → 403 | o limite decorativo da seção 5.2 |
| Conta free em qualquer rota de IA → 403 | o vazamento pelo `FEATURE_MIN_PLAN` |
| Quantidades = 20 e 10 | o limite que cresce sem decisão |
| Snapshot expirado gera um novo | a amostra que congela para sempre |
| Conta free não dispara consulta ao fornecedor | o custo por visitante voltando pela porta dos fundos |

---

## 10. Documentos vizinhos

- [Precificação](PRECIFICACAO.md) — de onde vem cada valor cobrado, e por que os planos
  reprovam no boot quando alguém mexe na tabela.
- [Arquitetura](ARCHITECTURE.md) — organização dos módulos e padrões de reuso.
- `backend/src/modules/showcase/showcase.service.ts` — a vitrine pública anônima, um degrau
  abaixo desta.
