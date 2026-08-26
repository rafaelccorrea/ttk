# Roadmap: Cortes do PikPok melhor que o Real Oficial

Documento de direção. Base factual: `docs/CONCORRENTE-REAL-OFICIAL.md` (o que eles têm, medido no app em 2026-08-25) e `docs/PLANO-CORTES.md` (o que nós temos). Este doc responde: **o que falta, em que ordem, e onde vencemos sem copiar.**

## 1. Tese

Eles vendem **views** para clipador/podcaster. Nós vendemos **vendas** para quem vende no TikTok Shop/Shopee. Ser "melhor" não é ter mais estilos de legenda — é que o corte saído do PikPok **converta**, e isso eles não conseguem fazer porque não sabem o que é um produto, uma live nem um pedido.

Regra de decisão para cada item abaixo:
- **Paridade**: coisa que o usuário compara lado a lado e desiste se não tiver. Fazer no mínimo aceitável.
- **Vantagem**: coisa que só faz sentido para quem vende. Fazer bem feito.
- **Não fazer**: coisa do mundo deles (campeonato de clipador, memes/brainrots, templates de fofoca).

## 2. Placar hoje

| Área | Real Oficial | PikPok hoje (código) | Veredito |
|---|---|---|---|
| Entrada de vídeo | URL YouTube/Twitch/Kick/Drive + upload | só upload 2–60 min / 2 GB (`cuts.controller.ts`) | **Paridade** — falta URL |
| Entrada de live | "monitora lives" (grava e corta depois) | gravação da live já existe em `modules/live`, mas não vira corte | **Vantagem** a destravar |
| Seleção de trechos | IA + score viral + "por que esse" + prompt de nicho | `cut_ai`: Whisper + LLM devolve `{titulo, gancho, motivo}` (`ai.service.ts#escolherCortes`), mas UI não mostra score/motivo | **Paridade barata** — dado já existe |
| Reenquadramento | tracking de falante, split, react | crop central fixo (`ffmpeg-runner.ts#cortar`) | **Paridade** — maior gap técnico |
| Legendas | ~25 estilos, preview ao vivo, emojis, gancho visual | 1 estilo hardcoded, opt-in, "tentativa não promessa" | **Paridade** — 4–5 estilos bastam |
| Editor | completo no browser (texto→vídeo, timeline, bibliotecas) | nenhum | **Não copiar inteiro** — só ajustar in/out e legenda |
| Publicação | automática + agendamento em 1/3/6 redes | download manual, `postOrder` pra postar à mão | **Paridade** (TikTok primeiro) |
| Analytics | Viralytics (views, horários, hashtags, tração) | ingestão/analytics de criadores existe (`modules/ingestion`, `creators`) mas não fecha o loop com os cortes | **Vantagem** — nosso analytics pode medir venda, não view |
| Templates / brand kit | 42 templates + galeria pública + brand kit | não existe | **Paridade mínima** (logo + cor + fonte) |
| Edição em massa | painel de layout em massa | Multiplicador G×C×A até 150 vídeos (`combinations`) | **Vantagem** — já somos melhores em variação de narrativa |
| Processamento | 30 min → 12 cortes em 12 min, tela de etapas, e-mail | fila serial (`MAX_JOBS_SIMULTANEOS = 1`), GlobalLoader novo, sem e-mail | **Paridade** — paralelizar + e-mail |
| Marca d'água no free | sim, remove retroativo ao assinar | não há free em cortes (gate Pro) | ok como está |
| Retenção | check-in diário, giro, conquistas, indicação 50% | nada | **Copiar o barato** |
| Aquisição | campeonatos pagos por view | — | **Não fazer** (é outro negócio) |
| Preço | 59,90 / 99,90 / 149,90, crédito não expira | cortes a partir do Pro; 2 cr rápido / 6 cr IA + transcrição | revisar posicionamento |

## 3. O que fazer — por fase

### Fase 0 — Expor o que já temos (dias)
Custo quase zero, muda a percepção na hora.
1. **Score + "Por que esse"** na grade de cortes: o LLM já devolve `gancho` e `motivo`; adicionar `score` (0–10) no `json_schema` de `escolherCortes` e mostrar. Ordenar por score.
2. **Banner de resultado**: "Encontramos N cortes" com o melhor em destaque (mesmo padrão do GlobalLoader).
3. **Etapas do job** já entregues (`GlobalLoader`); ligar **e-mail ao concluir** reaproveitando o SMTP do Live Copilot (lembrar: `SMTP_HOST` vazio desliga em silêncio).
4. **Título da aba com progresso** — já feito.

### Fase 1 — Paridade que o usuário compara (2–3 semanas)
1. **Import por URL** (YouTube primeiro; Twitch/Kick depois). `yt-dlp` no backend, mesmo pipeline do upload, limite de duração por plano. Mostrar thumb/título/duração antes de confirmar, como eles.
2. **Slider "quanto analisar" com custo em créditos na hora** — a UI deles resolve a ansiedade de gasto; nós já temos `assertSaldo` e `pendingTranscribeBlocks`, é só calcular antes.
3. **Estilos de legenda (4–5)**: Clássico, Karaokê (palavra ativa), Caixa alta impacto, Minimal, "Oferta" (com preço em destaque — este é nosso). Preview estático por estilo. Implementação: perfis de estilo ASS/libass no `ffmpeg-runner`, sem editor.
4. **Reenquadramento por rosto/falante**: detecção de rosto por amostragem (1 frame/s) → caixa suavizada → `crop` animado no ffmpeg. Fallback: centro. Modo "tela dividida" (2 rostos) fica pra depois.
5. **Fila paralela**: subir `MAX_JOBS_SIMULTANEOS` com controle por CPU e cobrança por corte já existente. Meta: 30 min de vídeo → cortes em < 10 min.

### Fase 2 — A vantagem: corte que vende (3–4 semanas)
1. **Cortar a própria live gravada**: botão "Gerar cortes desta live" na sessão do Live Copilot. Usa a gravação + transcrição já existentes; a IA escolhe trechos **com produto em cena / menção de preço / pico de pedidos** (temos o chat e os pins como sinal — eles não têm nada disso).
2. **Score de conversão** no lugar de score viral: pesos para menção de preço, prova social, CTA, produto ancorado, pico de comentários "quero/link". Mostrar "Por que vende".
3. **Produto ancorado no corte**: rótulo com nome + preço + "link na bio / carrinho", vindo do catálogo da sessão. Estilo de legenda "Oferta" usa isso.
4. **Ponte corte → Multiplicador** (já existe `POST /cuts/clips/:id/multiplier`): promover na UI — "1 corte bom → 30 variações com gancho e CTA". Isso é a nossa "edição em massa" e é melhor que a deles.
5. **Analytics de venda**: ligar cortes publicados a pedidos/cliques quando a API oficial da Shopee/TikTok Shop estiver ativa (ver `shopee-ingestao-status`). Enquanto isso, views por corte via ingestão que já temos.

### Fase 3 — Distribuição e retenção (contínuo)
1. **Publicação automática no TikTok** (Content Posting API) com agendamento; Instagram/YouTube depois. Filtros Renderizado / Agendado / Publicado na grade.
2. **Brand kit mínimo**: logo, cor, fonte; aplica em legenda e rótulo de produto.
3. **Retenção barata**: check-in diário de créditos (limitar a cortes), conquistas de onboarding (primeiro corte, primeira publicação), indicação com bônus na primeira compra (Stripe já registra a compra; ver `stripe-alinhada-ao-catalogo`).
4. **Landing**: trocar "views" por "vendas". Números concretos: "30 min de live → 12 cortes com produto em X min".

## 4. O que NÃO fazer
- Campeonatos de clipadores: negócio de agência, exige PIX, antifraude e moderação de views. Não é nosso cliente.
- Editor completo tipo CapCut no browser: meses de trabalho pra empatar. Fazer só in/out, trocar legenda e rótulo de produto.
- Templates de fofoca/brainrot/memes: público errado.
- Render 4K local: irrelevante para TikTok Shop.

## 5. Preço e posicionamento
- Eles: crédito por minuto analisado, nunca expira, 3 tiers. Nós: cortes travados no Pro, cobrados por corte + transcrição.
- Proposta: manter cobrança por corte (é mais previsível para o vendedor), mas **exibir o custo antes** (Fase 1.2) e dizer explicitamente que "suas horas/créditos não vencem" — mesmo modelo de adesão única do Live Copilot (`live-copilot-precos-e-tetos`). Rodar `npm run stripe:check` se mexer em preço.

## 6. Métricas para saber se ficamos melhores
- Tempo: 30 min de vídeo → N cortes em < 10 min (eles: 12 min).
- Qualidade: % de cortes que o usuário baixa/publica sem editar (meta > 50%).
- Diferencial: % de cortes com produto ancorado; vendas/cliques por corte publicado.
- Retenção: usuários que geram cortes 2 semanas seguidas.

## 7. Dependências e riscos
- Import por URL: yt-dlp quebra com frequência; manter atualizado e ter fallback de upload.
- Face tracking em CPU na Hostinger: medir custo; se pesar, rodar só em cortes escolhidos ou a 1 fps.
- Publicação automática exige app aprovado no TikTok; começar o processo agora.
- Banco em ca-central-1: novas telas de grade devem evitar N+1 (`banco-em-outro-continente`).

## Andamento — 2026-08-26
- ✅ Fase 0.1 score + "por que esse" · ✅ Fase 0.2 banner de resultado · ✅ Fase 1.1 import por URL (YouTube) · ✅ Fase 1.3 estilos de legenda (5) · ✅ Fase 1.4 reenquadramento por rosto (1 rosto; tela dividida fica pra depois). Detalhes e teste em `docs/PLANO-CORTES.md` ("Rodada ser melhor").
- ⏳ Fase 0.3 e-mail ao concluir · Fase 1.2 slider "quanto analisar" · Fase 1.5 fila paralela · Fase 2 inteira.
