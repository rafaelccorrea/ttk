# EchoTik — o que dá para extrair, e como gastar pouca requisição

Guia de referência para planejar as ingestões. Escrito depois de varrer a
documentação oficial (`https://opendocs.echotik.live/en`) e comparar com o que
o nosso `external-data.provider.ts` já usa hoje.

Leia a seção **"A regra que manda em tudo"** antes de desenhar qualquer coleta:
ela é o que separa uma chave que rende de uma chave que acaba em dois dias.

---

## 0. O problema que motivou este documento

Estado do catálogo em 15/08/2026:

| Medida | Valor |
|---|---|
| Produtos no banco | 646 |
| Produtos com pelo menos um vídeo | 74 (**11%**) |
| **Top 50 por vendas em 30d sem nenhum vídeo** | **34 de 50** |

Um produto sem vídeo é uma ficha sem prova. O usuário abre o item mais vendido
da vitrine, não vê um único criativo, e conclui — com razão — que o dado é
inventado. Credibilidade se perde no primeiro card vazio, e ela não volta na
segunda visita.

A causa não é falta de dado no fornecedor: é ordem de coleta. Hoje buscamos o
produto primeiro e o vídeo depois, e quando a cota acaba no meio da execução
sobra exatamente isso — produto sem vídeo. A seção 6 descreve a inversão que
resolve.

---

## 1. Autenticação e base

```
GET https://open.echotik.live/api/v3/<caminho>
Authorization: Basic base64(APP_ID:APP_SECRET)
```

- Credenciais em `https://echotik.live/platform/api-keys`; nós lemos de
  `ECHOTIK_APP_ID` / `ECHOTIK_APP_SECRET`.
- Sem header válido → **401**. Não há token com expiração: a credencial é fixa,
  então ela é o segredo a proteger.
- `code: 500` na resposta **não consome cota** — pode repetir. Já
  `"Usage Limit Exceeded"` significa cota estourada: nosso provider entra em
  cooldown de 10 minutos ao ver essa mensagem.

## 2. As duas famílias de endpoint

| Família | Caminho | O que é | Quando usar |
|---|---|---|---|
| **EchoTik** (offline) | `/echotik/...` | Base própria deles, agregada, com histórico e janelas de 1/7/15/30/60/90 dias. Ciclo **T+1** — produto recém-indexado pode ainda não aparecer | Tudo que é catálogo, ranking, métrica e histórico |
| **Real-time** | `/realtime/...` | Consulta direta ao TikTok público, no momento da chamada | URL de vídeo que expirou, legenda/transcrição, busca, detalhe fresco |

Regra prática: **planeje com o offline, resolva com o real-time.** O offline dá
volume e histórico; o real-time dá o que muda de hora em hora (URL assinada) ou
o que o offline não guarda (legenda).

## 3. A regra que manda em tudo

> **`page_size` é no máximo 10. Em todo endpoint paginado, sem exceção.**
> **Endpoint de lote aceita no máximo 10 ids por chamada.**

Não existe "puxar 100 de uma vez". Portanto, "muito dado em poucas requisições"
significa três coisas, nesta ordem de importância:

1. **Escolher o endpoint cuja LINHA carrega mais entidades.** Uma linha de
   `/echotik/video/list` já traz o vídeo, o `product_id` associado **e** o
   `unique_id` (@handle) do criador. São três entidades por linha — trinta por
   requisição. A mesma informação montada a partir de `product/list` +
   `product/video/list` + `creator/detail` custa três vezes mais.
2. **Filtrar na origem, não no nosso código.** Todo produto que baixamos e
   depois descartamos é cota queimada. O `product/list` aceita dezenas de
   filtros — inclusive `min_total_video_cnt`, que é o que resolve o problema da
   seção 0.
3. **Agrupar em lote sempre que houver endpoint `*/detail`.** Detalhe de
   produto, de vídeo, de criador e de live: todos aceitam 10 ids por chamada.

E uma cortesia do fornecedor: **`/echotik/batch/cover/download` não consome
cota**. Assinar capas é de graça, à vontade.

## 4. Catálogo de endpoints

Legenda: **★** = usamos hoje · **☆** = disponível e ainda não usado.

### Produto

| Endpoint | Caminho | Para quê |
|---|---|---|
| ★ Lista | `/echotik/product/list` | Descoberta com **muitos filtros** (ver 4.1) |
| ★ Detalhe em lote | `/echotik/product/detail` | Até **10 ids**; ~70 campos por produto |
| ★ Vídeos do produto | `/echotik/product/video/list` | Criativos que venderam aquele produto |
| ★ Criadores do produto | `/echotik/product/influencer/list` | Quem vende, com GMV por produto |
| ☆ Tendência | `/echotik/product/trend` | Série diária, **até 180 dias** de histórico |
| ☆ Ranking | `/echotik/product/ranklist` | Ranking diário/semanal/mensal por data |
| ☆ Avaliações | `/echotik/product/review/list` | Reviews — matéria-prima de objeção/prova |
| ☆ Lives do produto | `/echotik/product/live/list` | Lives que venderam o item |
| ☆ Categorias | `/echotik/product/category/*` | Árvore de 3 níveis |
| ☆ Detalhe real-time | `/realtime/product/detail` | Preço/estoque do momento |
| ☆ Id por link | `/realtime/product/share-link` | Colar link do TikTok Shop → id |

#### 4.1 Filtros do `product/list` que valem ouro

Estes filtros são o coração da economia de cota:

| Filtro | Efeito |
|---|---|
| **`min_total_video_cnt`** | **Só produtos que já têm N vídeos.** Resolve a seção 0 na origem |
| `min_total_ifl_cnt` | Só produtos com N criadores vendendo |
| `min_total_sale_30d_cnt` / `min_total_sale_gmv_30d_amt` | Piso de vendas/GMV no período |
| `min_product_rating`, `min_review_count` | Piso de reputação |
| `sales_trend_flag` | 1 = subindo, 2 = caindo, 0 = estável |
| `min/max_spu_avg_price` | Faixa de preço |
| `min/max_product_commission_rate` | Faixa de comissão — relevante para afiliado |
| `sales_flag` | 1 = vende por vídeo, 2 = vende por live |
| `from_flag` | 1 = loja local, 2 = cross-border |
| `off_mark=0` | Só o que está à venda |
| `min/max_first_crawl_dt` | Recorte por data de entrada no catálogo (`yyyyMMdd`) |
| `category_id` / `_l2_id` / `_l3_id` | Categoria em três níveis |
| `product_sort_field` + `sort_type` | 7 campos de ordenação, asc/desc |

### Vídeo

| Endpoint | Caminho | Para quê |
|---|---|---|
| ☆ **Lista** | `/echotik/video/list` | **O endpoint mais denso da API** (ver 4.2) |
| ☆ Detalhe em lote | `/echotik/video/detail` | 10 ids; views/likes por janela de 1/7/30d |
| ☆ Produtos do vídeo | `/echotik/video/product/list` | **Vídeo → produto**, aceita vários `video_ids` |
| ☆ Ranking | `/echotik/video/ranklist` | Vídeos que mais performaram no período |
| ☆ Tendência | `/echotik/video/trend` | Série do vídeo |
| ★ URL de download | `/realtime/video/download-url` | MP4 sem marca d'água, capa, capa animada |
| ☆ **Legenda/transcrição** | `/realtime/video/captions` | **Texto falado do vídeo, em WebVTT** |
| ☆ Comentários | `/realtime/video/comment/*` | Comentários e respostas |
| ☆ Hashtag | `/echotik/hashtag/ranklist`, `/realtime/hashtag/trending` | Hashtags em alta |

#### 4.2 Por que `video/list` é o endpoint mais valioso que ainda não usamos

Filtros: `region`, `product_category_id`, `product_id`, `user_id`,
`sales_flag` (1 = vídeo de venda), `is_ad`, `created_by_ai`,
`min/max_create_time`, `min/max_duration`, `min/max_total_views_cnt`.
Ordenação por likes, data ou views.

Cada linha devolve, de uma vez:

- o vídeo (id, descrição, hashtags, duração, dimensão, capa, métricas);
- **`product_id` e `video_products`** — o produto que ele vende;
- **`unique_id`** — o @handle do criador (que o `product/influencer/list` **não**
  devolve, e que hoje nos custa uma chamada extra de detalhe de criador);
- `total_video_sale_cnt` e `total_video_sale_gmv_amt` — quanto aquele criativo
  vendeu.

Ou seja: **uma requisição de 10 vídeos pode alimentar `videos`, `products` e
`creators` ao mesmo tempo**, e ainda diz quais produtos merecem entrar no
catálogo — os que já têm criativo provado.

### Criador

| Endpoint | Caminho | Observação |
|---|---|---|
| ★ Detalhe em lote | `/echotik/influencer/detail` | 10 ids; **é o que traz o @handle** |
| ☆ Lista | `/echotik/influencer/list` | Descoberta com filtros |
| ☆ Vídeos do criador | `/echotik/influencer/video/list` | Todo o portfólio dele |
| ☆ Produtos do criador | `/echotik/influencer/product/list` | O que ele vende |
| ☆ Ranking / Tendência | `/echotik/influencer/ranklist`, `/trend` | Evolução |
| ☆ Marcos | `/realtime/influencer/milestone` | Conquistas |

### Loja

`/echotik/seller/list`, `/seller/detail`, `/seller/product/list`,
`/seller/influencer/list`, `/seller/video/list`, `/seller/live/list`,
`/seller/ranklist`, `/seller/trend`.

Útil para uma frente que ainda não temos: **a partir de uma loja boa, puxar o
catálogo inteiro dela** — produtos que já vêm com vínculo de vídeo e criador.

### Live, música/sticker, busca e insights

- Live: `/echotik/live/list`, `/live/detail` (lote), `/live/trend`,
  `/live/product/list`, `/realtime/live/detail`.
- Música e sticker: detalhe, vídeos associados e ranking (real-time) — matéria
  prima para "áudio em alta".
- Busca: geral (offline) e real-time para vídeo, criador, produto, live, música,
  hashtag, **busca por imagem de produto** e "top search".
- Insights: `keyword inspiration`, `trending search term`, sugestões de termo.
- Categoria: `/echotik/category/detail` e `/category/trend`.

### Utilidades

| Endpoint | Caminho | Observação |
|---|---|---|
| ★ Assinar capas | `/echotik/batch/cover/download` | 10 URLs por chamada, **não consome cota**, link vale 24h, só funciona para o domínio `echosell-images.tos-ap-southeast-1.volces.com` |

## 5. Dicionário dos campos que importam

**Produto** — `product_id`, `product_name`, `cover_url`, `desc_detail`,
`specification`, `skus`, `sale_props`, `min_price`/`max_price`/`spu_avg_price`,
`discount`, `product_commission_rate`, `seller_id`, `category_id`(+l2/l3),
`product_rating`, `review_count`, `off_mark`, `free_shipping`, `is_s_shop`,
`shop_type`, `from_flag`, `sales_flag`, `sales_trend_flag`.
Métricas em janelas (1d/7d/15d/30d/60d/90d): `total_sale_*_cnt`,
`total_sale_gmv_*_amt`, `total_views_*_cnt`, `total_video_*`, `total_live_*`,
`total_ifl_*`.

**Vídeo** — `video_id`, `user_id`, `unique_id`, `video_desc`, `hash_tag`,
`create_time`, `duration`, `width`/`height`/`ratio`, `data_size`,
`reflow_cover`, `play_addr`, `region`, `created_by_ai`, `is_ad`, `sales_flag`,
`total_views_*`, `total_digg_*`, `total_comments_cnt`, `total_shares_cnt`,
`total_favorites_cnt`, `total_video_sale_cnt`, `total_video_sale_gmv_amt`.

**Criador** — `user_id`, `unique_id` (só no detalhe em lote e no `video/list`),
`nick_name`, `avatar`, `category`, `region`, `total_followers_cnt`,
`total_digg_cnt`, `total_post_video_cnt`, `total_views_cnt`, `total_live_cnt`,
e, no contexto de um produto, `per_product_ifl_sale_cnt` / `per_product_ifl_gmv_amt`.

## 6. Plano de coleta: máximo de dado, mínimo de requisição

O plano abaixo inverte a ordem atual (produto → vídeo) e passa a colher
**pelo vídeo**, que é onde o dado vem junto.

### Passo 1 — varredura por vídeo de venda (o motor)

```
/echotik/video/list
  region=BR
  sales_flag=1                     # só vídeo que vende
  product_category_id=<categoria>  # varre categoria a categoria
  min_create_time=<últimos 30 dias>
  video_sort_field=3 (views) sort_type=1
  page_size=10, page_num=1..N
```

Cada requisição rende até 10 vídeos + os produtos deles + os @handles dos
criadores. **20 categorias × 5 páginas = 100 requisições → até 1.000 vídeos e
algumas centenas de produtos, todos com criativo garantido.**

### Passo 2 — completar os produtos descobertos

```
/echotik/product/detail?product_ids=id1,...,id10
```

Uma requisição a cada 10 produtos novos. Traz preço, categoria, loja, rating e
todas as janelas de métrica.

### Passo 3 — tapar o buraco do catálogo atual

Para os produtos que já estão no banco sem vídeo, a busca dirigida:

```
/echotik/video/list?product_id=<id>&sales_flag=1&page_size=10
```

Uma requisição por produto, e **só para os que aparecem na vitrine** — os 50 do
topo primeiro. 34 requisições resolvem o pior da seção 0.

### Passo 4 — descoberta com piso de qualidade

Ao usar `product/list` (que continua útil para varrer categoria), passe sempre:

```
min_total_video_cnt=1      # nunca mais um produto sem criativo na vitrine
min_total_sale_30d_cnt=1   # nada de item parado
off_mark=0                 # só o que está à venda
```

### Passo 5 — capas (de graça)

Junte as `cover_url` de tudo que entrou e assine em lotes de 10 pelo
`/echotik/batch/cover/download`. Não consome cota. Refazer a cada 24h.

### Orçamento de uma execução típica

| Etapa | Requisições | Rende |
|---|---|---|
| Varredura por vídeo (20 cat. × 5 pág.) | 100 | ~1.000 vídeos, ~300 produtos, ~500 criadores |
| Detalhe dos produtos novos (10 por vez) | ~30 | ficha completa |
| Detalhe dos criadores novos (10 por vez) | ~50 | @handle e seguidores |
| Tapar buraco dos 50 do topo | ~35 | vídeo onde faltava |
| Capas | 0 | — |
| **Total** | **~215** | catálogo com vídeo em **~100%** dos itens da vitrine |

Para comparação, a rotina atual gasta ordem de grandeza parecida e entrega 11%
de cobertura de vídeo, porque paga uma requisição por produto para descobrir
que ele não tem criativo nenhum.

## 7. Oportunidades que a documentação abre e ainda não exploramos

1. **`/realtime/video/captions` no lugar do Whisper.** A tela "Analisar Vídeo"
   hoje sobe o arquivo e paga transcrição. Para vídeo que já está no TikTok,
   este endpoint devolve o texto falado direto. Muda o custo por análise e o
   tempo de espera.
2. **`product/trend` com 180 dias.** Nossa série hoje é o que acumulamos desde
   que começamos a coletar. Uma chamada devolve o histórico inteiro — gráfico
   de verdade desde o primeiro dia do produto na vitrine.
3. **`product/review/list`.** Avaliação real é a melhor fonte de objeção e de
   prova social para o roteiro. Hoje o roteiro é escrito sem elas.
4. **Loja como unidade de descoberta.** `seller/product/list` puxa o catálogo de
   uma loja que já provou vender.
5. **Ranking por data** (`product/ranklist`, `video/ranklist`) — permite montar
   "o que subiu esta semana" sem depender do nosso próprio histórico.
6. **Busca por imagem de produto** — o vendedor manda a foto do que ele vende e
   a gente acha o mesmo item no catálogo, com métricas.

## 8. Armadilhas já pagas (não repetir)

- **`page_size > 10` é recusado.** Não adianta tentar 50.
- **`cover_url` chega como STRING contendo um array JSON** de `{url, index}` —
  precisa de parse, não é uma URL solta.
- **URL de capa expira em ~3 dias e o CDN recusa hotlink (403).** Por isso
  espelhamos no nosso S3.
- **URL de vídeo (`play_addr`) expira em horas.** Nunca gravar como se fosse
  permanente: guardar a URL canônica do post e resolver na hora de exibir, via
  `/realtime/video/download-url`.
- **`product/influencer/list` não devolve @handle**, só `user_id` e `nick_name`.
  Sem o @handle não dá para montar o link do perfil — o handle vem do
  `influencer/detail` (lote de 10) ou, de graça, do `video/list`.
- **`"Usage Limit Exceeded"`** deve derrubar a execução inteira em cooldown; sem
  isso as chamadas seguintes queimam retry à toa.
- **T+1**: produto novo no TikTok pode não estar no offline ainda. Se for
  crítico, confirmar pelo real-time.

## 9. Antes de queimar a próxima chave

- [ ] Definir o orçamento de requisições da execução (`apiMonthlyBudget`) e
      conferir que o provider respeita.
- [ ] Rodar a varredura por vídeo (passo 1) **antes** de qualquer coleta por
      produto.
- [ ] Ligar `min_total_video_cnt=1` em toda descoberta por `product/list`.
- [ ] Rodar o passo 3 nos 50 do topo e conferir na vitrine: **nenhum card sem
      vídeo**.
- [ ] Medir depois com a mesma consulta da seção 0 e registrar aqui o novo
      percentual.
