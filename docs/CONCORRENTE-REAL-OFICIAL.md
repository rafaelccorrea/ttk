# Concorrente: Real Oficial (cortes virais)

Análise feita em 2026-08-25 navegando logado em `app.realoficial.com.br` (conta free, 30 créditos do check-in) e na landing `realoficial.com.br`.

## O que é

Ferramenta brasileira de **cortes virais**: vídeo longo (YouTube, Twitch, Kick, Google Drive ou upload) → N clipes 9:16 com legenda, reenquadramento por rosto e publicação automática. **Não** compete com o Live Copilot; compete com o nosso módulo de **Cortes** (`/cortes`) e, indiretamente, com o Multiplicador.

Diferença estrutural: o produto deles é metade SaaS de IA, metade **marketplace de clipadores** (campeonatos pagos por view). Isso gera aquisição orgânica que uma ferramenta pura não tem.

## Fluxo de criação (wizard em 4 passos)

1. **Fonte**: link YouTube/Twitch/Kick/Drive. Upload de arquivo só pra assinante. Mostra thumb, canal e duração do vídeo antes de continuar.
2. **Formato**: 9:16 ou 16:9 (16:9 só em plano pago). Enquadramento: *Automático (recomendado), Foco no rosto, Centro, Tela dividida, React*. Brand kit opcional. **Prompt personalizado** com presets contando usos ("Engraçados 17.325", "Polêmicos 15.264", "Leo Dias 8.939", "Educativo 8.466").
3. **Duração**: por corte (Automático / 30s / 1 / 1:30 / 3 / 5 / 15 min — os longos só em plano pago) e **intervalo do vídeo a analisar** com slider — mostra na hora quantos créditos vai gastar ("selecionou 30 min de 177 min").
4. **Legendas**: ~25 estilos com preview ao vivo num mock de Reels (com contador de likes fake), toggles *Emojis*, *Gancho visual*, *Compartilhar no Hub de Conteúdo*.

Depois: tela de processamento (ver abaixo) e e-mail quando pronto.

## Tela de processamento (referência do nosso GlobalLoader)

- Pill "Tempo estimado **10 min**" (recalcula: caiu pra 2 min no fim).
- Título "Estamos preparando seus cortes…", barra roxa com % (31 → 93%, avança suave).
- 5 etapas em timeline vertical: Carregando seu vídeo → Entendendo o vídeo → Buscando os melhores momentos → Montando os cortes → Quase pronto. Concluída = check roxo; atual = spinner + texto branco; futuras = número cinza.
- Título da aba: "(2/5) Entendendo o vídeo — Real Oficial".
- Rodapé: "Enquanto isso: seus cortes vão sair com legenda automática, rosto enquadrado e prontos pra postar", link "Explorar →", "Pode fechar a página — avisamos por e-mail".
- Tempo real medido: 30 min de vídeo → 12 cortes em ~12 min.

## Resultado

- Banner "🎉 A IA encontrou 12 cortes com potencial viral" destacando o melhor: **score viral (8.5)**, título, "**Por que esse:** …", botões Baixar / Editar antes.
- Grid de clipes com prévia em baixa resolução, faixa de tempo (28:23 ~ 29:20), score, título e justificativa.
- Filtros: Todos / Renderizados / Não renderizados / No Launcher / Agendados / Publicados. Ordenação: mais virais, tempo, duração, título.
- Reenquadramento de verdade: corta pro entrevistador quando ele fala (tracking de falante), não crop central.
- Free: marca d'água + projeto expira em 3 dias. Assinar remove a marca de tudo retroativamente.
- Painel lateral "Edição em massa".

## Editor

Editor completo no browser: edição por **texto** (apagar palavra corta o vídeo), cenas detectadas por falante, timeline com faixas de legenda e vídeo, estilos, background/gradientes, Auto Edit (PRO), IMAX Mode, Motion, bibliotecas de Templates / Texto / Formas / Brand Kit / Música / IA / Emoji / Memes / Brainrots / Filtros / Transições / Animações. Render local em até 4K.

## Templates e Brand Kit

- Galeria pública com templates da comunidade (com contador de usos) + ~42 templates base oficiais, quase todos no nicho fofoca/pop: "Feed da Fofoca", "X em Alta", "DM Vazado", "WhatsApp Vazado", "Léo Dias 1/2/3", "Plantão Urgente", "Reddit Confessa", "Review UGC", "Antes e Depois", "Fato ou Fake", "Top 5 Insano", "Brainrot Quiz", "Mini Documentário".
- Brand kit: logo/cores/fontes reutilizáveis nos cortes.

## Viralytics

Dashboard de performance dos cortes por rede (TikTok/Instagram/YouTube): views, engajamento, "Real vs externo", crescimento de seguidores, **melhores horários pra postar** (heatmap com base em todos os criadores da plataforma), hashtags em alta/caindo, cortes perdendo tração, sugestões de repost, agendamentos. Exportar como imagem.

## Campeonatos (marketplace de clipadores)

- Marcas/criadores financiam; clipador posta com hashtag e ganha por view via PIX.
- Ativos: CBLOL 2026 (R$1/1.000 views, R$15k, 735 participantes, 11,8M views), Stream Gabriel Morais, Academia Rafael Toro (R$0,50/1.000), Celso Athayde e Podpah 3.0 (ranking, R$10k/mês, mínimo 100k views, 556 participantes, 140M views).
- Exige conectar redes sociais + chave PIX. Regras longas contra corte roubado.
- Isso é o motor de aquisição deles: o clipador entra pra ganhar dinheiro e vira assinante.

## Gamificação e crescimento

- **Check-in diário**: 30 créditos/dia no free, 60 pra assinante (evento 29/07–31/08). Sequência com marcos (+30 em 7 dias).
- **Giro de prêmios**, **Conquistas** (primeiro projeto +15, primeiro corte +30, primeira publicação +45, 10 cortes +75).
- **Convidar amigos**: os dois ganham 50% dos créditos do plano na primeira compra do indicado. Código de afiliado unificado.
- Aviso de free em toda tela: "Seus vídeos saem com marca d'água".

## Preços (app, 2026-08-25)

| Plano | Mensal | Créditos/mês | Horas | Redes | Extras |
|---|---|---|---|---|---|
| Lite | R$ 59,90 | 1.800 | 30h | 1 | — |
| Creator | R$ 99,90 | 3.000 | 50h | 3 | postagem automática, clipes até 15 min, horizontal |
| Viral | R$ 149,90 | 5.400 | 90h | 6 | + API |
| Business | R$ 2.000+ | — | 500h | 100 contas | suporte dedicado |

- Todos: 4K local, editor, legendas, giro, check-in, monitoramento de lives, 60 dias de armazenamento. Créditos **nunca expiram**; pacotes avulsos; PIX ou cartão; anual com toggle.
- Cobrança observada: 30 min analisados custaram **15 créditos** (0,5 cr/min), embora a UI diga "1 crédito = 1 minuto".

## Onde eles ganham de nós (módulo Cortes hoje)

| | Real Oficial | PikPok Cortes |
|---|---|---|
| Entrada | URL YouTube/Twitch/Kick/Drive + upload | só upload (2–60 min, 2 GB) |
| Seleção | IA com score viral + justificativa + prompt de nicho | Whisper + LLM (`cut_ai`) sem score/justificativa exposta; modo rápido por silêncio |
| Reenquadramento | tracking de falante, split, react | crop central fixo |
| Legendas | ~25 estilos, emojis, gancho visual, editor por palavra | 1 estilo hardcoded, opt-in |
| Editor | completo no browser | nenhum |
| Publicação | automática + agendamento + analytics | download manual |
| Templates/Brand kit | sim | não |
| Massa | 100+ cortes, painel de edição em massa | matriz G×C×A do Multiplicador (outro problema) |
| Aquisição | campeonatos, check-in, indicação | — |
| Tempo | 30 min → 12 cortes em ~12 min | fila serial, 1 job por vez |

## Onde dá pra ser melhor (nossa vantagem é vender, não viralizar)

1. **Corte que vende, não corte que viraliza.** Score de *conversão* (menciona preço, prova, CTA, produto em cena) em vez de "viral 8.5". Ninguém faz isso pra TikTok Shop.
2. **Ligar o corte ao produto**: o corte já sai com o produto ancorado (pin, nome, preço) — usamos a base do Live Copilot. Eles não têm noção de produto.
3. **Cortar a própria live gravada** direto do módulo `live` (já temos a gravação e o catálogo). Eles só "monitoram lives".
4. **Ponte corte → Multiplicador** (já existe) vira diferencial: 1 corte bom → 30 variações com gancho/CTA. Eles têm "edição em massa" de layout, não de narrativa.
5. Paridade mínima que precisa existir pra não perder na comparação: **import por URL**, **reframe por rosto/falante**, **3–5 estilos de legenda com preview**, **score + "por que esse"**, **tela de processamento com etapas** (em andamento).
6. Copiar mecânicas de retenção baratas: check-in diário de créditos, conquistas, indicação com bônus na primeira compra, aviso de marca d'água no free.
7. Landing: eles vendem "+1 bilhão de views". A nossa deve vender "R$ em vendas" e "produtos ancorados".

## Riscos

- Se eles adicionarem resposta em tempo real na live entram no nosso quintal; hoje não têm nada de chat/pin/anti-bloqueio.
- Os campeonatos criam uma base de clipadores fiel que é difícil de deslocar — nossa base tem de ser vendedor, não clipador.
