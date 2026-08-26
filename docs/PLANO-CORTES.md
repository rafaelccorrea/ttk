# Cortes — vídeo longo vira N vídeos curtos

Status: **F1, F2 e F3 implementadas em 2026-08-23** (sem deploy — precisa rodar as migrations `CreateCuts` e `AddCutCaptions` e passar pelo QA abaixo). Upload por presign ficou de fora (ver F3).

## Decisões fechadas
| Decisão | Valor |
|---|---|
| Feature de plano | `cuts`, a partir do **Pro** (`FEATURE_MIN_PLAN.cuts = 'pro'`) |
| Modos | **Rápido** (sem IA, só ffmpeg) e **Inteligente** (Whisper + LLM escolhe os trechos e escreve título/gancho) |
| Quem paga | O usuário, em créditos. Nada sai do plano "de graça". |
| Preço | `cut` = **2 cr/corte** (rápido) · `cut_ai` = **6 cr/corte** (inteligente) **+** `transcribe` por bloco de 10 min começado (6 cr) |
| Fonte | vídeo de **2 a 60 min**, até 2 GB, mp4/mov/mkv/webm, precisa ter trilha de vídeo; áudio é obrigatório só no modo inteligente |
| Cortes | 3 a 20 por job; duração alvo de cada corte entre **15 e 90 s** (o usuário escolhe mín/máx) |
| Saída | 9:16 (padrão, crop central), 16:9 ou 1:1 · 720p · H.264 `veryfast` CRF 26 · AAC 128k |
| Upload | multipart para **disco** (mesmo padrão do Live Copilot), nunca em buffer |
| Execução | in-process com batimento + cron que reabre job travado e **estorna** (padrão do `live.service`) |
| Storage | S3 privado via `MediaMirrorService.putVideo`, servido por `/api/v1/media/s3/...` |

### Por que esses preços
- `cut` (2 cr = R$ 0,20 de face): custo real ≈ R$ 0,10 no pior caso (CPU do re-encode de 90 s + MP4 de ~25 MB parado no S3). Margem 2× — passa o `assertProfitability` (mín. 1,4×).
- `cut_ai` (6 cr = R$ 0,60): além do corte, a seleção por LLM (gpt-5.4, ~8k tokens de transcrição de 60 min + 2k de saída ≈ R$ 0,30 por job, rateado por corte com o mínimo de 3 cortes ≈ R$ 0,10) + título/gancho por corte. Pior caso R$ 0,30/corte. O Whisper NÃO está aqui — é cobrado à parte pela ação `transcribe` já existente, que já acompanha a duração.
- Custo por crédito dos dois fica em R$ 0,05, abaixo do vídeo (R$ 0,06), então `worstCostPerCredit()` não muda e nenhum plano é afetado no boot.
- Exemplo: 30 min, 10 cortes → rápido **20 cr (R$ 2)**; inteligente **60 + 18 = 78 cr (R$ 7,80)**.

### Fluxo de cobrança (igual ao Live Copilot)
1. `POST /cuts` (upload) → `assertSaldo` com o mínimo (qtd × cut[_ai] [+ 1 bloco transcribe]) → recusa cedo quem não tem saldo, ANTES de processar.
2. Pipeline mede a duração com ffmpeg → recusa fora de 2–60 min (sem cobrar) → **cobra** `cut`/`cut_ai` × qtd (+ `transcribe` × blocos no inteligente) numa transação junto com os marcadores `pendingCutCharge`/`pendingTranscribeBlocks` no job.
3. Job termina `pronto` → marcadores zerados. Cortes que falharem individualmente são estornados um a um (`refund(cut, 1)`); job só fica `falhou` se nenhum corte sair.
4. Cron a cada 2 min: job em `processando` sem batimento há 15 min → estorna tudo pendente, marca `falhou` com mensagem "reinicialização do servidor".

## Pipeline
```
upload em disco → cut_job(pendente) → assertSaldo → resposta 201 na hora
  background:
  ├─ ffmpeg inspeciona: duração, streams (vídeo obrigatório)
  ├─ cobra
  ├─ RÁPIDO:  extrai áudio mono → silencedetect → janelas [min,max] alinhadas a silêncio
  │           (sem áudio: janelas fixas de (min+max)/2 espalhadas pelo vídeo)
  ├─ INTELIGENTE: audio-chunker (ogg 24k, fatias de 15 min) → Whisper verbose (segmentos com tempo)
  │           → LLM (json_schema) escolhe N trechos {inicio, fim, titulo, gancho, motivo}
  │           → validação: dentro da duração, respeita [min,max], sem sobreposição; faltou → completa com o modo rápido
  └─ para cada trecho: ffmpeg -ss/-to re-encode + enquadramento → putVideo (S3) → cut_clip(pronto)
  → job pronto → apaga o upload do disco
```

## Modelo de dados
`cut_jobs`: id, userId, status (`pendente|processando|pronto|falhou`), mode (`rapido|inteligente`), format (`9:16|16:9|1:1`), quantity, minSeconds, maxSeconds, sourceName, sourceDurationSeconds, sourcePath (tmp, apagado no fim), error, processingStartedAt, pendingCutCharges (int), pendingTranscribeBlocks (int), createdAt.

`cut_clips`: id, jobId, userId, position, startSeconds, endSeconds, title, hook, reason, url, status (`pendente|pronto|falhou`), error, createdAt.

## API
| Rota | O quê |
|---|---|
| `POST /cuts` (multipart `file` + campos mode, format, quantity, minSeconds, maxSeconds) | cria o job, responde na hora |
| `GET /cuts` | lista jobs do usuário |
| `GET /cuts/:id` | job + cortes (a tela faz polling enquanto `processando`) |
| `DELETE /cuts/:id` | apaga job, cortes e objetos no S3 |
| `GET /cuts/quote?mode&quantity&durationSeconds` | preço estimado antes de enviar (a tela mostra "vai custar X cr") |
Guards: `SupabaseAuthGuard` + `PlanFeatureGuard` com `@RequiresPlanFeature('cuts')` no controller inteiro.

## Frontend
- Rota `/cortes` dentro de `RequireSubscription` + `PlanGate feature="cuts"`; item "Cortes" no menu ao lado do Multiplicador.
- Tela: (1) escolha do modo com preço lado a lado, (2) upload com barra de progresso + duração lida no navegador para mostrar a cotação antes de enviar, (3) parâmetros (qtd, faixa de duração, formato), (4) lista de jobs com polling e grade de cortes (`<video preload="metadata">`, título/gancho copiável, download, excluir).

## Fases
### F1 — Modo rápido (sem IA)  [x]
- [x] `billing.config.ts`: feature `cuts`, ações `cut` e `cut_ai`, `ACTION_MIN_PLAN`, perk "Cortes automáticos" no Pro
- [x] `FfmpegRunner.cortar()` (intervalo + enquadramento) e `silencios()` (silencedetect)
- [x] `cut-planner.ts`: planejamento puro (janelas por silêncio / fixas, validação dos trechos da IA) + spec
- [x] entidades + migration `CreateCuts`
- [x] `CutsService`: upload, pipeline, cobrança com marcadores, cron de job travado, delete com limpeza no S3
- [x] `CutsController` + DTO + módulo registrado no `AppModule`
- [x] Frontend: service, página `/cortes`, rota, menu
### F2 — Modo inteligente (com IA)  [x]
- [x] `AiService.escolherCortes()` com `json_schema` estrito e `CostFeature 'cuts'`
- [x] Transcrição via `AudioChunkerService` + Whisper `verboseTimestamps`, offset por fatia
- [x] Cobrança de `transcribe` por bloco + `cut_ai`; fallback para janelas rápidas quando a IA devolve menos que o pedido
- [x] Título/gancho na tela, com copiar
### F3 — Legenda queimada + Multiplicador  [x]
- [x] Legenda queimada (opt-in no modo inteligente): SRT por corte a partir dos segmentos do Whisper (`srtDoTrecho`), filtro `subtitles` do libass com estilo fixo (branco, contorno preto, terço de baixo). **Tentativa, não promessa**: se o libass/fonte falhar no servidor, o corte sai sem legenda e `cut_clips.captions=false` registra isso. A fonte vai no repo: `backend/assets/fonts/DejaVuSans*.ttf` (licença livre, `LICENSE-DejaVu.txt`), resolvida por `__dirname` tanto de `src/` quanto de `dist/`; `CUTS_FONTS_DIR` sobrescreve a pasta e `CUTS_FONT_NAME` a fonte (padrão `DejaVu Sans`).
- [x] "Usar no Multiplicador": `POST /cuts/clips/:id/multiplier {role, produto?}` lê o corte do S3 e chama `CombinationsService.uploadClip`. Respeita o teto duro de `clip-timing.ts` (gancho 8 s, corpo 25 s, CTA 12 s) — a tela só habilita os blocos em que o corte cabe. Não cobra (clipe é grátis; a montagem cobra).
- [ ] Upload direto ao S3 por presign — **deixado de fora de propósito**: exige CORS no bucket e não muda nada enquanto o upload em disco (padrão do Live Copilot, 2 GB) funciona. Volta se o disco do Hostinger virar gargalo.

## Riscos e mitigação
- **Hostinger/LVE**: fila serial do ffmpeg — 1 job de cortes por vez por processo (`MAX_JOBS_SIMULTANEOS = 1`), 720p `veryfast`. Um job de 20 cortes de 90 s leva minutos e segura o Multiplicador nesse meio-tempo; aceito na v1.
- **Memória**: fonte fica em disco; só cada corte final (≤ ~30 MB) passa por buffer no `putVideo` (teto de 40 MB do mirror).
- **Whisper 25 MB**: resolvido pelo chunker (ogg 24 kbps fatiado).
- **IA sem fala**: se a transcrição vier vazia, o job cai para o modo rápido e o `cut_ai` excedente é estornado para `cut` (diferença devolvida).

## Onde está no código
- Backend: `backend/src/modules/cuts/` (`cuts.controller.ts`, `cuts.service.ts`, `cut-planner.ts` + spec, `entities/`, `dto/`), migration `1786670800000-CreateCuts.ts`, `FfmpegRunner.cortar/silencios/rodarLendoStderr`, `AiService.escolherCortes`, ações `cut`/`cut_ai` e feature `cuts` em `billing.config.ts`, `CostFeature 'cuts'`.
- Frontend: `frontend/src/pages/Cuts/index.tsx`, `frontend/src/services/cuts.service.ts`, rota `/cortes`, item "Cortes" no menu.

## QA antes de liberar
1. **Plano**: conta Essencial vê o cadeado em `/cortes` e recebe 403 em `POST /cuts`; conta Pro entra.
2. **Saldo**: conta Pro com 0 créditos recebe 402 no upload ANTES de processar (mensagem com o custo).
3. **Rápido**: vídeo de 5 min, 6 cortes, 30–60 s, 9:16 → 6 MP4 verticais 720p, cortes espalhados do início ao fim, saldo debitado 12 cr. Verificar que as bordas caem em pausas.
4. **Inteligente**: mesmo vídeo com fala → título/gancho em cada corte, "IA" no chip; saldo debitado 6×6 + 6 (1 bloco) = 42 cr. Conferir a linha `cuts` no relatório de custos (`ai_cost_events`).
5. **Vídeo sem áudio no inteligente** → job falha com a mensagem "use o modo rápido" e NADA é cobrado. No rápido, o mesmo vídeo funciona (janelas fixas).
6. **Fora da duração** (1 min ou 61 min) → job falha com a mensagem da faixa, nada cobrado.
7. **Fonte curta para a quantidade** (2 min, 20 cortes de 60–90 s) → entrega os que cabem e estorna a diferença; extrato mostra o `refund`.
8. **Restart no meio**: matar o processo durante um job → em ≤ 17 min o cron marca `falhou`, estorna os pendentes e apaga o upload do tmp.
9. **Excluir job** → objetos `cuts/<userId>/...` somem do S3; excluir job em processamento é recusado (409).
10. **Segundo upload com um job rodando** → 409 "aguarde terminar".
11. **Multiplicador** durante um job de cortes: monta mais devagar mas termina (fila serial do ffmpeg).
12. `npm run stripe:check` não é necessário (não há produto Stripe novo).
13. **Legenda (F3)**: modo inteligente com "Legenda queimada" marcado → o corte sai com a fala no terço de baixo (ícone de legenda no card). Se o servidor não tiver fonte, o corte sai SEM legenda e sem erro (`captions=false`); aí configurar `CUTS_FONTS_DIR` com um .ttf (DejaVu) e repetir.
14. **Multiplicador (F3)**: corte de ≤ 25 s → "Usar no Multiplicador" → Corpo; aparece na lista de clipes de corpo em `/multiplicador`. Corte de 45 s → só os blocos em que não cabe ficam desabilitados com "passa de N s"; forçar pela API devolve 400 com a conta na mensagem.
15. **Smoke local (2026-08-23, Windows)**: ver a tabela "QA executado" abaixo para a rodada completa pelo navegador.

## QA executado em 2026-08-24 (local: vite 5174 → backend local → Supabase, conta interna `pikpok@pikpok…`)
| # | Item | Resultado |
|---|---|---|
| 3 | Rápido, 2:30, 6 cortes 30–60 s, 9:16 | ✅ Após correção do planner: 6/6 com 15–25 s; com 30–60 s saem 5 (o máximo sem sobreposição). Bordas nos silêncios. |
| 4 | Inteligente, 2:31 com fala (TTS pt-BR), 6 cortes | ✅ Whisper transcreveu, IA sugeriu 12 trechos (2 válidos sem sobreposição), complemento rápido preencheu o espaço livre → 3 cortes; títulos/ganchos coerentes ("Como usar o kit em 2 minutos", "Cupom, frete grátis e últimas unidades"). Cotação 36 + 6 = 42 cr. |
| 13 | Legenda queimada | ✅ Renderizada no terço de baixo com a fonte embarcada em `backend/assets/fonts` (não depende de fonte do sistema). |
| 14 | Usar no Multiplicador | ✅ Corte de 20 s → só "Corpo" habilitado (Gancho "passa de 8s", CTA "passa de 12s"); enviado, apareceu em `/multiplicador` como `teste-cortes-corte-1.mp4`. |
| 9 | Excluir job | ✅ Some da lista; objetos apagados do S3. |
| — | Cotação/UI | ✅ `2 cr/corte` e `6 cr/corte`, duração lida no navegador, progresso de upload, polling até `pronto`. |
| 1, 2, 5, 6, 7, 8, 10, 11 | plano, saldo, sem áudio, fora da duração, estorno, restart, 409, concorrência | ⏳ Não executados nesta rodada (conta interna tem créditos ilimitados; precisam de conta Pro/Essencial comuns e de derrubar o processo no meio). |

Observações da rodada:
- A leitura da duração no navegador falhou uma vez para o mesmo arquivo que funcionou em outra (`lerDuracaoDoVideo`); o servidor confere de qualquer jeito. Só afeta a estimativa de blocos de transcrição na cotação.
- A IA devolve trechos sobrepostos entre si mesmo com a instrução de não sobrepor; a validação greedy (ordem da IA) fica com o melhor de cada região e o rápido completa. Log `IA sugeriu N, M válido(s)` no `CutsService` mostra isso.

## QA em PRODUÇÃO — 2026-08-24 (pikpokviral.com.br, conta interna)
- Backend deployado com `CutsController` (rota `/api/v1/cuts/*` respondendo), frontend estático subido.
- Job inteligente com legenda (2:31, 6 pedidos): Whisper + IA em prod, 3 cortes (2 da IA com título/gancho + 1 rápido), **legenda queimada renderizada no Linux com a fonte embarcada** (`backend/assets/fonts`), job `Pronto`. Tempo total ≈ 2 min.
- Pendência menor: `lerDuracaoDoVideo` no navegador falha às vezes (só afeta a estimativa de blocos na cotação; o servidor mede de verdade).

## Loader de progresso (GlobalLoader) — como testar

Componente: `frontend/src/components/ui/GlobalLoader.tsx` — variante `completo` (etapas) usada no job de Cortes e `LoaderLeve` ("PikPok…" pulsando). Não existe overlay global: o `BrandLoader` (usado em todas as telas, gates, Suspense das rotas e checagem de sessão) passou a renderizar o `LoaderLeve` inline, então todas as telas mostram o mesmo loader dentro do layout. O `index.html` tem um splash estático com a mesma marca para o intervalo antes do React montar. Teste: recarregar com `Network: Slow 3G` (splash → loader da rota → loader de dados da tela, sem tela vazia).

1. **Variante leve**: navegar entre páginas pesadas (ex.: Estúdio → Cortes) com rede lenta (DevTools › Slow 3G). Deve aparecer "PikPok…" com reticências pulsando em tela cheia, sem etapas.
2. **Variante completa em Cortes**: enviar um vídeo. Enquanto o job estiver `processando`, o card do job mostra: pill "Tempo estimado 10 min" (Inteligente) ou "4 min" (Rápido), título "Estamos preparando seus cortes…", barra com % e 5 etapas.
   - Sem clips ainda: etapa 2 "Entendendo o vídeo" (Inteligente) ou 3 "Buscando os melhores momentos" (Rápido); o % sobe sozinho até o teto da etapa e nunca recua.
   - Com clips: etapa 4 "Montando os cortes" (60–80%, avançando com cada corte concluído); no penúltimo/último corte, etapa 5 "Quase pronto".
   - Título da aba deve virar "(N/5) <etapa> — PikPok" e voltar ao normal quando o job termina.
   - Link "Explorar →" leva a /tendencias. Ao ficar `pronto` ou `falhou`, o loader some e a grade de cortes/alerta de erro continua como antes.
3. Com `prefers-reduced-motion`, spinner e reticências ficam estáticos.
