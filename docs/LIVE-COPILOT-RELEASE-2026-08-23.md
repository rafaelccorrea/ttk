# Live Copilot — release de 23/08/2026

Sete features implementadas e testadas na mesma rodada, mais a análise do
concorrente direto (LiveGo Pro). Versão publicada também como artifact
(Dossiê Live Copilot); **esta é a cópia canônica, versionada com o código.**

Estado: código em working tree (não commitado — push = deploy). Testes:
backend verde (jest + tsc), desktop verde (54 testes + tsc), frontend verde.
Migrations aplicadas no Supabase: `AddLiveRunEndReason`, `AddLiveRunEvents`,
`AddLiveSignupHours` (todas `IF NOT EXISTS`, reversíveis).

---

## 1. Preços, horas e cortesia (`billing.config.ts`)

| Plano | Preço | Horas de live |
|---|---|---|
| Free | — | **10 min de cortesia, exclusivos do free** (`grantLiveTrial` só concede a plano de rank 0) |
| Essencial | R$ 39,90 (anual 399,90) | **o plano vem com 15h** (uma vez, na adesão) |
| Pro | R$ 89,90 (anual 899,90) | **o plano vem com 40h** |
| Business | R$ 249,90 (anual 2.499,90) | **o plano vem com 60h** + envio automático |

Não há hora mensal recorrente em nenhum plano: acabou, é pack. (Preços mensais
voltaram aos valores base — o aumento que existiu durante o dia era para bancar
horas mensais que foram descartadas.)

Packs (para qualquer plano com o copiloto): 1h R$ 9,90 · 5h R$ 39,90 ·
15h R$ 99,90 · 40h R$ 219,90.

**Bônus de adesão** (`signupLiveHours` → `grantSignupLiveHours`, chamado por
`setPlan`): concedido UMA vez por conta; renovação não repete (delta zero);
upgrade concede só a diferença (Essencial→Pro = +25h); downgrade não devolve.
Coluna `app_users.liveSignupMinutesGranted` guarda o maior bônus já concedido.
É custo único de aquisição (15h ≈ R$ 38,70 / 40h ≈ R$ 103,20 / 60h ≈ R$ 154,80)
e por isso **não entra em `assertProfitability`**, que compara grandezas mensais.

**Por que as horas são de adesão e não mensais:** o guard de boot
(`assertProfitability`, margem 1,4× sobre créditos×R$0,06 + minutos×R$0,043)
impede incluir 15/40/60h *por mês* nos preços atuais; como custo único de
aquisição elas cabem, e o catálogo fica simples de anunciar.

**Gate de feature:** `FEATURE_MIN_PLAN.live_copilot = 'free'` (painel abre para
todos; o free só tem a cortesia). Envio automático continua Business
(`trocarModo`).

## 2. Tempo de live (`live-reply.service.ts`, `live-run.entity.ts`)

- **Duração máxima de UMA live por plano:** Essencial/Pro 6h, Business 24h
  (`maxLiveDurationMinutes`, checado em `cobrarMinuto` com `minutesCharged`
  como relógio). Ao estourar: fim normal com `endReason='limite_duracao'`,
  SSE `duration_limit_reached`, desktop encerra com aviso.
- **Bloco mínimo de 10 min** (`LIVE_MIN_MINUTES`) debitado na abertura da run
  (`abrirRun`); os 10 primeiros batimentos só marcam o relógio.
- **`live_runs.endReason`** (`manual | limite_duracao | creditos | aviso_tiktok
  | erro`): motivo legível por máquina; todo fim iniciado pelo desktop é
  `manual` por padrão (corrigiu bug antigo em que o botão do painel marcava a
  run como `erro`).

## 3. Cartão de pergunta (`questionNew`)

Desktop escuta `questionNew` do webcast (sem `msgId` → `msgIdSintetico`,
hash de texto+autor+janela de 60s). Flag `isQuestion` viaja até o backend,
fura a heurística de triagem e `ordenarPorPrioridade` põe essas perguntas na
frente do lote (sort estável).

## 4. Detector de aviso do TikTok (`desktop/warning-detector.ts`)

Varredura da BrowserView a cada 15s com a cascata `seletores.aviso` servida
pelo backend (`live-config.service.ts` v2, override por env
`LIVE_ENVIO_SELETORES_AVISO`). Ao detectar: pausa o envio, faixa no cockpit,
evento `aviso_tiktok` em `live_run_events`. **Encerrar a live é opt-in**
(`encerrarAoDetectarAviso`, desligado por padrão) — clica no botão de encerrar
(`seletores.botaoEncerrar`) e fecha a run com `endReason='aviso_tiktok'`.
Debounce por assinatura; falha de cascata reporta na telemetria com o
`contexto` novo (`live_selector_failures.context`).

## 5. Fixar produto (`desktop/product-pinner.ts`)

Chips dos produtos da base no cockpit (seção recolhida por padrão); clique
tenta o pin no painel do TikTok Shop via DOM (`seletores.painelProdutos` /
`botaoPin`), localizando pelo TÍTULO normalizado. 100% best-effort: falha vira
mensagem ("fixe manualmente…") + evento `pin_produto` + telemetria.

## 6. Rotação automática de produtos (`RotadorDeProdutos`)

Toggle + intervalo (2–60 min) nas Configurações. Round-robin da base, lido a
cada batida de 30s (mudar no meio da live vale na hora). Três falhas seguidas
pausam a rotação com aviso discreto no cockpit.

## 7. Bloqueio de espectadores

Lista de @ nas Configurações (`usuariosBloqueados`, local no electron-store,
nunca sobe ao backend). Descarte ANTES do anonimizador — não vira hash, lote,
custo nem resposta. Comparação exata por @ normalizado.

## 8. Cockpit — limpeza

Escalações ("precisa de você") com teto de 300px e no máximo 4 cards à vista
(+N aguardando); produtos recolhidos; parada da rotação sem a faixa vermelha.

## 9. Contratos novos

- SSE: `duration_limit_reached`; `endReason` em `stats`/`ended`.
- `POST /live/runs/:id/events` (`aviso_tiktok` | `pin_produto`).
- `isQuestion` no lote de chat; `endReason` opcional no `POST runs/:id/end`.
- `ConfigDeEnvio.seletores`: `aviso`, `botaoEncerrar`, `painelProdutos`, `botaoPin`.
- IPC desktop: `produtos:listar`, `produtos:fixar`, canais `live:aviso-tiktok`,
  `live:rotacao-parada`.

## 10. Teste ponta a ponta (simulação, 23/08)

Backend local + desktop `dev:sim` contra o Supabase: run aberta com bloco de
10 min debitado, `conectando → ativa` no heartbeat, 16 mensagens → 13
respostas (gpt-5.4-mini, respondendo com a base) + 4 escalações, 15/16
marcadas como pergunta, audiência agregada, rotação girando e registrando
`pin_produto · falhou · painel_produtos` (esperado: a simulação não tem o
painel do TikTok). Pendente com TikTok real: calibrar seletores do banner e do
painel (por env, sem rebuild).

## 11. Concorrente — LiveGo Pro (livegopro.digital)

- 100% nuvem, licença por computador, **sem limite de horas** (custo variável
  quase zero: respostas por gatilho/template com verniz de IA). R$ 97/mês,
  trimestral 197, anual 397.
- Funções: resposta "inteligente", fixação/rotação de produto por conversão,
  reprodução de lives gravadas, duplicação cíclica de oferta relâmpago,
  comentários programados, "escudo anti-bloqueio" com desligamento preventivo
  e rotação de IP, bloqueio de usuários, picotador de áudio, app/comunidade.
- Paridade fechada nesta release: desligamento preventivo (F4), pin +
  rotação (F5/F6), bloqueio de usuário (F7), intenção de compra (F3).
- Gaps deliberados: reprodução de live gravada e comentários programados
  (ambos contra a detecção do TikTok — risco de conta); notificações de
  venda; app/comunidade.
- Nosso posicionamento: IA de verdade com a base extraída da própria live,
  modo painel sem risco de ToS, LGPD (espectador anonimizado). A promessa
  deles de "não pode bloquear sua conta" com rotação de IP é insustentável.
