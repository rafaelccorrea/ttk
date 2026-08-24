# Plano: Cortes automáticos de vídeo longo

Status: proposta (2026-08-23). Não implementado.

## Ideia
Usuário sobe um vídeo longo (ex.: live gravada, review, vlog) e o sistema devolve N cortes curtos
prontos pra postar. Dois modos:

- **Sem IA (mecânico)**: fatia o vídeo em janelas de duração fixa/escolhida (ex.: 30s, 45s, 60s),
  opcionalmente com detecção de silêncio pra não cortar no meio de frase. Só ffmpeg, custo baixo.
- **Com IA (inteligente)**: transcreve (Whisper), o LLM escolhe os melhores trechos (gancho, produto,
  oferta, momento engraçado), gera título/legenda por corte e opcionalmente legenda queimada. Custo maior.

## O que já existe (reaproveitar)
| Peça | Onde |
|---|---|
| Runner ffmpeg (fila serial, timeout 10min, `ffmpeg-static`) | `backend/src/common/media/ffmpeg-runner.ts` |
| Whisper com timestamps por segmento | `backend/src/modules/studio/transcription.service.ts` (`verboseTimestamps`) |
| Fatiador de áudio longo (900s) | `backend/src/modules/live/audio-chunker.service.ts` |
| Upload grande (2GB, multer em memória) | `live.controller.ts` (`MAX_UPLOAD_BYTES`) |
| S3 + presign de leitura | `backend/src/modules/media/media-mirror.service.ts` |
| Cobrança por ação + gate de plano | `billing.config.ts`, `billing.service.ts`, `plan-feature.guard.ts` |
| LLM (OpenAI) | `backend/src/modules/studio/ai.service.ts` |
| Grade de resultados no front | `frontend/src/pages/Multiplier/index.tsx` |

## O que falta
1. **Corte por intervalo no runner** — hoje só normaliza/concatena/dubla. Adicionar `cortar(input, inicioS, fimS)`
   com `-ss/-to` + re-encode (corte exato, não em keyframe) + `-vf` pra 9:16 (crop central ou blur nas laterais).
2. **Detecção de silêncio** — `-af silencedetect` pra ajustar bordas do corte no modo sem IA.
3. **Upload direto pro S3 (presigned PUT)** — vídeo de 20 min em buffer na memória do Node em host compartilhado
   não vai aguentar. O backend só recebe a key depois.
4. **Job durável** — não há BullMQ. Usar o padrão já existente: entidade com `status` + `@Cron` que pega
   `pendente` e processa (igual `higgsfield-sentinela`). Sobrevive a restart; a promessa solta de hoje não.
5. **Entidades**: `cut_jobs` (userId, sourceKey, durationS, modo, minS, maxS, qtd, status, erro) e
   `cut_clips` (jobId, inicioS, fimS, url, titulo, legenda, status, ordem).
6. **Ação de crédito** `corte` em `billing.config.ts` (ver preço abaixo).
7. **Tela** `/cortes` (rota irmã do Multiplicador, `PlanGate feature="cuts"` ou dentro de `multiplier`).

## Limites propostos
- Duração da fonte: **mín 2 min, máx 60 min** (v1: 30 min). Acima disso o custo Whisper e o tempo de ffmpeg
  no Hostinger explodem.
- Tamanho: até 2GB (já é o teto do live).
- Cortes: 3 a 20 por job; duração do corte 15–90s (usuário escolhe faixa).
- Timeout do runner: hoje 10 min; um vídeo de 30 min com re-encode de 10 cortes cabe, mas normalizar
  a fonte inteira não — **nunca normalizar a fonte, só os cortes**.

## Pipeline
```
upload (presign S3) → cria cut_job pendente → cron pega
  ├─ ffmpeg: extrai duração (stderr) + áudio mono 16k
  ├─ modo mecânico: silencedetect → janelas → lista de intervalos
  └─ modo IA: audio-chunker → Whisper → LLM escolhe intervalos + título/legenda
→ pra cada intervalo: ffmpeg corte 9:16 (+ legenda ASS opcional) → S3 → cut_clip pronto
→ job concluído; erro parcial não derruba os outros cortes
```

## Custo estimado por job (30 min, 10 cortes)
- Whisper: ~US$0,18 (0,006/min) → já coberto pela ação `transcribe` (6 cr / 10 min = 18 cr).
- LLM seleção: transcrição de 30 min ≈ 5k tokens de entrada; barato (< 1 cr).
- ffmpeg: custo de CPU, não de dinheiro — é o gargalo real.
- Preço sugerido: **mecânico 2 cr/corte; IA 6 cr/corte + transcribe**. Job IA de 10 cortes ≈ 80 cr (R$8).
  Rodar `npm run stripe:check` não é necessário (não é produto Stripe, é crédito).

## Riscos
1. **Hostinger compartilhado** (LVE): re-encode de 10 cortes de 60s em 1080p leva minutos e a fila é serial
   por processo — um job trava a fila do Multiplicador. Mitigação: cortar em 720p, `-preset veryfast`,
   limitar jobs concorrentes a 1, e cron com lock. Se virar feature forte, é o primeiro motivo pra um worker
   separado (VPS).
2. Memória: nunca carregar o vídeo fonte em buffer; trabalhar com arquivo temporário no disco e stream pro S3.
3. Qualidade do corte por IA: LLM escolhendo intervalos direto da transcrição funciona bem pra fala
   (lives de venda, reviews); pra vídeo sem fala cai pro modo mecânico automaticamente.
4. Direitos: vídeo do próprio usuário; sem download de URL de terceiros na v1.

## Fases
- **F1 (mecânico, ~3 dias)**: presign upload, entidades + migration, `cortar` no runner, cron, tela com faixa
  de duração + grade de resultados, cobrança `corte`. Já entrega valor.
- **F2 (IA, ~3 dias)**: Whisper + chunker + prompt de seleção (JSON com intervalos, título, gancho), fallback
  mecânico, legenda burn-in opcional.
- **F3 (polimento)**: reaproveitar cortes como clipes `hook/body/cta` do Multiplicador (integração natural),
  pré-visualização, reordenar, excluir.

## Decisões em aberto (pro dono)
- Feature do plano: nova (`cuts`) ou dentro de `multiplier`?
- Formato de saída: só 9:16 ou também 1:1/16:9?
- Legenda queimada na v1 ou v2?
