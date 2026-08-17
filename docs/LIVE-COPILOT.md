# Live Copilot

O vendedor sobe a gravação de uma live que já fez. O backend transcreve, e a IA
extrai dali a lista dos produtos — nome, preço, variações, frete, promoção — mais
as perguntas e objeções que o chat repetiu. Ele revisa e corrige o que quiser: a
base é dele.

Durante a **próxima transmissão**, um aplicativo de computador lê o chat ao vivo e
responde a partir dessa base. Em modo painel, a resposta aparece na tela para ele
copiar ou falar em voz alta. Em modo automático, o app digita e envia no chat do
TikTok em nome dele.

> Preço nunca é escrito pela IA. Ela escreve um marcador e o backend substitui
> pelo valor do banco. Esta é a regra que organiza metade das decisões deste
> documento.

---

## 1. As três fases

| Fase | O que entrega | Estado |
|---|---|---|
| **0** | Gravação → base de conhecimento editável na web | pronta |
| **1** | Copiloto lê o chat ao vivo e responde **no painel** | pronta |
| **2** | O app **digita e envia** no chat do TikTok | pronta, atrás de aceite de termo |
| 3 | Import do TikTok Shop por API, embeddings, analytics de conversão | não iniciada |

**O modo painel não é degradação, é um caminho de primeira classe.** Ele entrega o
valor central — a resposta certa, na hora certa, com o preço certo — sem tocar no
chat e sem risco de ToS. É o default no onboarding, é para onde o app volta
sozinho quando algo quebra, e é a única forma de operar para quem não aceita o
termo de risco.

Tudo está escondido do cliente por `LAUNCH_LIVE_COPILOT` até que se decida lançar.

---

## 2. Arquitetura: o que roda onde, e por quê

| No **desktop** (Electron) | No **backend** (NestJS) |
|---|---|
| A sessão logada do TikTok (cookies, partition persistente) | Chaves de IA (Anthropic, OpenAI) |
| A conexão com o chat da live | A base de conhecimento e todo o estado |
| A digitação e o envio do comentário | A decisão de o que responder |
| A aplicação final dos limites de cadência | A política de limites e o kill switch |

A divisão não é arbitrária. O que exige a **identidade do vendedor** — sessão,
IP residencial, o ato de escrever em nome dele — só pode acontecer na máquina
dele. O que exige **segredo ou verdade única** — chave de API, saldo, histórico,
o texto que vai ao ar — só pode acontecer no servidor. O desktop nunca vê uma
chave de IA; o servidor nunca vê o cookie do TikTok.

### O caminho de uma pergunta

1. **Chat** → `desktop/src/main/tiktok-chat.ts` recebe pelo WebSocket do webcast.
   O `@` do espectador é trocado por um hash **aqui**, antes de qualquer coisa.
2. **Lote** → `rate-limiter.ts` acumula ~800 ms de mensagens. Uma chamada de
   modelo para várias perguntas.
3. **Triagem** (`live-reply.service.ts`, sem custo de IA): é pergunta? já foi
   perguntada? O dedup usa trigrama do `pg_trgm`; ruído é descartado de graça.
4. **Modelo** → a base inteira vai no `system` com cache de 1 h; as perguntas vão
   depois do breakpoint. `claude-haiku-4-5`, com reprocesso em `claude-opus-5` na
   faixa cinzenta de perguntas que decidem compra.
5. **Guardas** → substituição do preço, truncamento seguro, âncora em fonte,
   lista negra, link e menção. É aqui que a maioria das respostas ruins morre.
6. **Entrega** → SSE para o app. Painel, ou fila de envio se o modo for automático.
7. **Cobrança** → um minuto por batimento, com janela de 55 s.

---

## 3. As regras duras

Cada uma existe porque a alternativa custa caro para alguém. Todas têm teste.

### Preço nunca vem do modelo
`aplicarPrecos` / `contemPrecoLiteral` / `truncarSeguro` — `live-reply.service.ts`

O modelo escreve `{{PRECO:id}}`; o backend troca pelo valor da coluna `priceBrl`.
Três coisas escalam a resposta em vez de publicá-la: marcador que sobrou (id
inexistente ou malformado), valor em dinheiro **que não está na base**, e preço
perdido no truncamento.

O truncamento merece atenção: cortar em 140 caracteres **depois** da substituição
pode partir "R$ 1.499,90" em "R$ 1.4". O corte recua para antes do preço, e se
ainda assim o valor sumiu, a frase não vai — porque "sai por apenas" sem número é
tão ruim quanto número errado.

> Bug que já esteve em produção: o detector exigia separador de milhar
> (`\d{1,3}(?:\.\d{3})*`) enquanto o formatador escrevia `1499,90` sem ponto. Para
> **todo produto de quatro dígitos** a proteção estava inerte. Os testes não
> pegaram porque a fixture usava `R$ 1.299,00` digitado à mão — um formato que o
> código nunca emitia. Hoje o teste tira o preço de `aplicarPrecos`, nunca da mão.

**Valores da base são permitidos.** "Frete grátis acima de R$ 99" é o que o
vendedor cadastrou em `shippingInfo` — repetir isso não é inventar. A pergunta
não é "tem número?", é "esse número é nosso?", e a comparação é por dígitos
porque `R$ 99`, `99 reais` e `99,00` são o mesmo valor.

### Resposta pronta exige fonte citada
`decidirResposta` — confiança ≥ 0,80 **e** `sourceProductIds` não vazio. Confiança
0,99 sem fonte é o retrato do modelo inventando com segurança: vai para o painel.

### Nada de link ou menção
Gatilho clássico de anti-spam, e quase sempre sinal de conteúdo copiado do chat.

### Nenhum dado de espectador sai da máquina
O `@` vira `sha256(username + runId + salt)`, com salt por execução — sha256 de um
`@` sozinho é quebrável, o espaço de nomes do TikTok é público e finito. O texto
do chat é apagado em 30 dias por cron; a linha fica, porque os contadores e a
resposta são registro do serviço prestado.

No diagnóstico de seletor quebrado, o HTML é reconstruído nó a nó com **allowlist**
de atributos. `aria-label` sai como `[rotulo:coment]`, nunca com o valor — antes
ele passava por teste de substring, e `aria-label="Maria: quero comprar, deixei
like"` atravessava inteiro.

### Kill switch e pausa param o envio de verdade
Não só no cliente: `filaDeEnvio` consulta o kill switch no **servidor**. Confiar
apenas no app é confiar num binário na máquina de outra pessoa.

---

## 4. Cobrança

Duas moedas que não se convertem — os números estão em
[PRECIFICACAO.md](PRECIFICACAO.md).

- **Créditos de IA**: roteiro, imagem, transcrição, e a extração da base (`live_extract`).
- **Minutos de live**: o tempo com o copiloto ligado. Vendidos por hora em
  add-ons, com **10 minutos de cortesia por conta** que entram no mesmo saldo.

Exclusivo do plano **Business** — e a razão não é preço, é risco: é o único lugar
do produto onde escrevemos em nome do vendedor, dentro da plataforma dele. Isso
pede o degrau que já vem com suporte de gente.

---

## 5. Como medir

**Custo** — `ai_cost_events` grava tokens reais por chamada (`AiService.chamar` é
o único caminho até o Claude, então nada escapa). `GET /api/v1/admin/margem?dias=30`
mostra a margem realizada por recurso e aponta onde o custo **medido** passou do
**estimado**.

**Produto** — o que dizer se isto funciona:

| Métrica | Onde | Por que importa |
|---|---|---|
| Taxa de cópia | `live_replies.copiedAt` | No modo painel, é a única prova de que a resposta prestou: um humano escolheu usá-la |
| Taxa de entrega | `deliveryStatus` | No automático, quanto realmente chegou ao chat |
| Latência p95 | `latencyMs` | Acima de ~15 s a resposta vira ruído: o assunto já passou |
| Escalações por live | `status = 'escalada'` | Muitas = o produto não está resolvendo sozinho |
| `cache_read_input_tokens` | log do motor | Zero = o prompt está sendo invalidado e o custo é outro |

---

## 6. Operação

| Variável | Para quê |
|---|---|
| `LAUNCH_LIVE_COPILOT` | `true` libera a feature para clientes. Sem ela: 404 e fora do menu |
| `LIVE_ENVIO_KILL_SWITCH` | `true` desliga o envio automático da frota inteira |
| `DESKTOP_DOWNLOAD_WINDOWS` / `_MAC` | URL do instalador. Sem ela, a tela diz "em breve" |
| `DESKTOP_VERSION`, `DESKTOP_ASSINADO` | Versão exibida e se avisa do SmartScreen |
| `COMP_ACCOUNT_EMAILS` | Contas que atravessam a trava de lançamento (a equipe) |

**Quando o TikTok mudar o HTML:** vai chegar telemetria em
`live_selector_failures`, e os apps caem sozinhos para painel após 3 falhas.
Publique a cascata nova em `live-config.service.ts` e faça deploy do **backend** —
os seletores são servidos por lá justamente para o conserto não depender de
release de app nem de o usuário aceitar atualizar.

**Publicar o app:** `cd desktop && npm run dist` gera o instalador NSIS em
`desktop/release/`. Suba o `.exe` e o `latest.yml` num GitHub Release e aponte
`DESKTOP_DOWNLOAD_WINDOWS` para ele. Sem assinatura de código, o Windows exibe o
SmartScreen — a tela avisa antes, mas assinar é o que resolve.

---

## 7. Riscos assumidos

**Ban de conta.** Automatizar comentário viola os Termos do TikTok. A conta em
risco é a do vendedor, não a nossa. O que mitiga: sessão, máquina e IP são dele
(não há farm nem proxy — é isso que dispara banimento em massa), cadência humana
com jitter, teto por minuto, nunca o mesmo texto duas vezes, kill switch remoto, e
o aceite de termo exigido **pelo backend**, versionado: quem aceitou a redação
antiga não autorizou a prática nova.

**LGPD.** O chat é escrito por gente que nunca foi nossa cliente. Só hash e
retenção de 30 dias; a Anthropic entra como subprocessadora na política.

**Dependência de reverse-engineering.** Ler o chat depende do
`tiktok-live-connector`. É o ponto único de falha mais provável — por isso o código
fala com a interface `ChatSource`, e não com a lib.

**SSE em memória.** O `Subject` por processo exige sticky session por `runId`
antes de escalar horizontalmente. Mesma limitação já documentada no
`single-flight.interceptor.ts`.

---

## 8. O que não está pronto

**O teste que ninguém fez ainda:** subir uma live gravada **real** e conferir se
os produtos, preços e variações extraídos batem com o que foi falado. Toda a
Fase 1 e 2 se apoiam nessa base estar correta, e isso nunca foi verificado com
áudio de verdade. É o primeiro item antes de qualquer lançamento.

Também aberto:
- Janela estreita entre o débito do minuto e a gravação do marcador de pendência
  (crash exatamente ali perde o crédito sem rastro); resolver pede transação.
- A Fase 3 inteira.
- Instalador sem assinatura de código.
- O app nunca rodou contra uma live real do TikTok.

---

## 9. Rodar e testar

```bash
# backend (a flag é o que faz a feature aparecer)
cd backend && LAUNCH_LIVE_COPILOT=true npm run start:dev
cd frontend && npm run dev
cd desktop  && npm run dev

# testes
cd backend  && npm test         # inclui o motor e a carteira de minutos
cd frontend && npx vitest run
cd desktop  && npm test         # os freios do envio e a anonimização

# a live sintética ponta a ponta (precisa de banco)
cd backend && npm run simular:live
```

A simulação é o que pega o que teste unitário não vê — ela já encontrou
fragmentação do dedup em rajada, migration não aplicada e violação de FK na
limpeza. Rode depois de mexer no motor.
