import type { WebContents } from 'electron';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EstadoConexao } from '../shared/desktop-api';

/**
 * O modo foco da metade esquerda: a view do TikTok existe para a LIVE, e nada
 * além dela.
 *
 * Sem isto a view era um navegador completo do tiktok.com dentro do app — feed,
 * perfis, vídeos — e o copiloto virava desculpa para rolar o For You com a
 * câmera prestes a ligar. O que a esquerda mostra passa a ser decidido por
 * estado, não por clique:
 *
 *   deslogado            → a tela de login do TikTok (única função dela);
 *   logado, fora de live → uma tela de espera nossa (logo + animação), sem
 *                          nenhum link para escapar;
 *   ao vivo detectado ou
 *   run conectada        → a página da live DELE, e só ela;
 *   run encerrada ou
 *   saldo esgotado       → de volta à espera, com o motivo estampado.
 *
 * A trava tem duas camadas porque o TikTok é uma SPA: `will-navigate` segura as
 * navegações de verdade, e `did-navigate-in-page` desfaz as internas (pushState)
 * que escapam do primeiro — o app simplesmente recarrega o destino permitido.
 *
 * NADA aqui mexe em cobrança: detectar a live só TROCA O QUE A VIEW MOSTRA.
 * Quem abre a run (e o gasto de minutos) continua sendo o botão "Entrar na
 * live" do painel, porque gasto silencioso é pior que clique a mais.
 */

/** De quanto em quanto tempo a espera confere se a live começou. */
const INTERVALO_DETECCAO_MS = 30_000;

type Modo = 'login' | 'espera' | 'live';

export class ModoFoco {
  private logado: boolean | null = null;
  private conexao: Pick<EstadoConexao, 'status' | 'tiktokUsername' | 'simulada'> = {
    status: 'desconectado',
    tiktokUsername: null,
    simulada: false,
  };
  /** O @ dono da sessão, para saber QUAL live abrir antes de a run existir. */
  private usuario: string | null = null;
  /** A espera detectou a transmissão no ar (sem run aberta ainda). */
  private aoVivo = false;
  /** Motivo estampado na tela de espera (fim da run, saldo esgotado). */
  private aviso: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deps: {
      /** A view atual — por função, porque ela morre e renasce com a janela. */
      view: () => WebContents | null;
      /** URL que a view mostra para quem precisa logar. */
      urlLogin: string;
      /** Confere o cookie de sessão da partição. */
      estaLogado: () => Promise<boolean>;
      /** O @ logado na partição, ou `null` quando não der para ler. */
      usuarioLogado: () => Promise<string | null>;
      /** `fetch` com os cookies da partição (para espiar a página da live). */
      buscar: (url: string) => Promise<string | null>;
      /** A logo do app como data URL, ou `null` — a espera tem fallback. */
      logo: string | null;
      /**
       * Um vídeo local para tocar atrás do chat simulado (`PIKPOK_SIM_VIDEO`),
       * para a demo parecer uma live de verdade. `null` = fundo escuro.
       */
      videoSimulado: string | null;
    },
  ) {}

  /**
   * Prende uma view recém-criada ao modo foco. Chamado a cada `anexarTikTok`:
   * os listeners morrem com a view, então cada encarnação é presa de novo.
   */
  anexar(view: WebContents): void {
    view.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.on('will-navigate', (evento, url) => {
      if (!this.permitida(url)) evento.preventDefault();
    });
    // A SPA navega por pushState e o `will-navigate` nunca dispara: aqui o
    // desvio é detectado DEPOIS e desfeito — a view volta ao destino do modo.
    view.on('did-navigate-in-page', (_evento, url) => {
      if (!this.permitida(url)) this.aplicar(true);
    });
    void this.deps.estaLogado().then((logado) => this.definirLogado(logado));
    this.iniciarDeteccao();
  }

  definirLogado(logado: boolean): void {
    const mudou = this.logado !== logado;
    this.logado = logado;
    if (!logado) {
      this.usuario = null;
      this.aoVivo = false;
      this.aviso = null;
    }
    if (mudou) this.aplicar();
  }

  definirConexao(estado: EstadoConexao): void {
    const anterior = this.conexao.status;
    this.conexao = {
      status: estado.status,
      tiktokUsername: estado.tiktokUsername,
      simulada: estado.simulada,
    };

    if (estado.status === 'sem_saldo') {
      // O painel também conta, mas é AQUI que o vendedor está olhando — a live
      // sai da tela junto com o motivo, senão parece que o app quebrou.
      this.aviso =
        estado.motivo ??
        'Os minutos acabaram e o copiloto parou de responder. Compre mais horas no site para voltar.';
      this.aoVivo = false;
    } else if (estado.status === 'encerrada' || estado.status === 'erro') {
      /*
       * Encerrou = página virada, SEM aviso preso na tela. O motivo já está no
       * painel, que é onde se lê; deixá-lo aqui ("Encerrado pelo vendedor…")
       * fazia a espera exibi-lo para sempre E suprimia a detecção — o vendedor
       * que continuava transmitindo nunca via a própria live voltar à esquerda.
       */
      this.aviso = null;
      this.aoVivo = false;
    } else if (estado.status === 'conectando') {
      // Run nova = página limpa: o motivo da anterior já foi lido.
      this.aviso = null;
    }

    if (anterior !== estado.status) this.aplicar();
  }

  private modo(): Modo {
    if (this.logado === false) return 'login';
    const { status } = this.conexao;
    if (status === 'conectando' || status === 'ativa' || status === 'pausada') {
      return 'live';
    }
    // A detecção só vale sem aviso pendente: depois de "acabou o saldo", voltar
    // a mostrar a live (que continua no ar) esconderia exatamente o recado.
    if (this.aoVivo && this.usuario && !this.aviso) return 'live';
    return 'espera';
  }

  private alvo(): string {
    const modo = this.modo();
    if (modo === 'login') return this.deps.urlLogin;
    /*
     * Em simulação não existe live no tiktok.com para mostrar: navegar para
     * `/@live.simulada/live` pintava a página "Sem LIVE" do TikTok — que
     * parece um erro nosso. No lugar entra o NOSSO chat: as perguntas dos
     * espectadores fictícios e as respostas da IA, correndo como numa live —
     * é onde se VÊ o copiloto trabalhando (`publicarNoChatSimulado`).
     */
    if (modo === 'live' && this.conexao.simulada) {
      const html = paginaDeChatSimulado(this.deps.logo, this.deps.videoSimulado);
      /*
       * COM vídeo a página vira arquivo, e não data URL: uma página `data:`
       * não tem permissão para carregar `file://` — o player ficaria preto.
       * Servida de `file://`, ela enxerga o vídeo local do mesmo esquema.
       */
      if (this.deps.videoSimulado) {
        const caminho = join(tmpdir(), 'pikpok-chat-simulado.html');
        try {
          writeFileSync(caminho, html, 'utf8');
          return pathToFileURL(caminho).toString();
        } catch {
          // Sem disco, sem vídeo: cai no data URL de fundo escuro.
        }
      }
      return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    }
    if (modo === 'live') {
      const nome = (this.conexao.tiktokUsername ?? this.usuario ?? '')
        .trim()
        .replace(/^@/, '');
      if (nome) return `https://www.tiktok.com/@${nome}/live`;
    }
    return paginaDeEspera(this.aviso, this.deps.logo);
  }

  private permitida(url: string): boolean {
    const modo = this.modo();
    // `file:` é a nossa própria página do chat simulado servida de disco.
    if (url === 'about:blank' || url.startsWith('data:') || url.startsWith('file:')) {
      return true;
    }
    // Login exige o site inteiro liberado dentro do domínio: o fluxo passa por
    // redirects, 2FA e captcha, todos em subdomínios do tiktok.com.
    if (modo === 'login') return /^https:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(url);
    if (modo === 'live') {
      const nome = (this.conexao.tiktokUsername ?? this.usuario ?? '')
        .trim()
        .replace(/^@/, '')
        .toLowerCase();
      if (!nome) return false;
      try {
        const u = new URL(url);
        return (
          /(^|\.)tiktok\.com$/i.test(u.hostname) &&
          u.pathname.toLowerCase().startsWith(`/@${nome}`)
        );
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Leva a view ao destino do modo atual, sem recarregar o que já está lá. */
  private aplicar(forcar = false): void {
    const view = this.deps.view();
    if (!view || view.isDestroyed()) return;
    const alvo = this.alvo();
    const atual = view.getURL();
    /*
     * Igualdade EXATA, inclusive para data URLs. A versão anterior tratava
     * "estou em qualquer data:" como "estou na página certa" — e a espera e o
     * chat simulado são ambos data URLs, então a troca entre eles nunca
     * acontecia: conectava a live e a esquerda ficava presa no "aguardando".
     * `aplicar` só roda em mudança de estado, então recarregar no falso
     * negativo da comparação custa um load raro, não um loop.
     */
    if (!forcar && atual === alvo) return;
    void view.loadURL(alvo).catch(() => undefined);
  }

  /**
   * Empurra uma linha para o chat simulado da esquerda — pergunta de
   * espectador ou resposta da IA. Só faz algo quando a página do chat está de
   * fato na tela; fora dela (espera, login, live real) a chamada é descartada
   * em silêncio, porque não há onde desenhar.
   */
  publicarNoChatSimulado(item: { autor: string; texto: string; ia: boolean }): void {
    if (!this.conexao.simulada || this.modo() !== 'live') return;
    const view = this.deps.view();
    if (!view || view.isDestroyed()) return;
    void view
      .executeJavaScript(
        `window.__pikpokChat && window.__pikpokChat(${JSON.stringify(item)})`,
      )
      .catch(() => undefined);
  }

  /**
   * A espera vigia a live começar: de meio em meio minuto, espia a página
   * pública `/@{user}/live` com a sessão do vendedor e procura a marca de
   * transmissão no ar. Achou → a view troca sozinha para a live dele; o painel
   * continua mandando no gasto. Qualquer tropeço (regex, rede, HTML remontado)
   * é silêncio — na pior das hipóteses o vendedor conecta pelo painel, que
   * também leva a view para a live.
   */
  private iniciarDeteccao(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.detectar();
    }, INTERVALO_DETECCAO_MS);
    this.timer.unref?.();
  }

  private async detectar(): Promise<void> {
    if (this.modo() !== 'espera' || this.logado !== true || this.aviso) return;
    try {
      this.usuario = this.usuario ?? (await this.deps.usuarioLogado());
      if (!this.usuario) return;
      const html = await this.deps.buscar(
        `https://www.tiktok.com/@${this.usuario}/live`,
      );
      // `"status":2` é como o JSON de hidratação do LiveRoom marca transmissão
      // no ar; fora do ar vem 4. Dado de terceiro, sem contrato — ver acima.
      const noAr = html !== null && /"status"\s*:\s*2\b/.test(html);
      if (noAr !== this.aoVivo) {
        this.aoVivo = noAr;
        this.aplicar();
      }
    } catch {
      // Detecção é conveniência: falhar calado é o comportamento certo.
    }
  }
}

/**
 * A tela de espera, inteira num data URL: sem arquivo para empacotar, sem rota
 * para servir, e — o que importa — sem um link sequer para navegar.
 */
function paginaDeEspera(aviso: string | null, logo: string | null): string {
  const recado = aviso
    ? `<p class="aviso">${escapar(aviso)}</p>`
    : '<p class="sub">Assim que você entrar ao vivo no TikTok, ela aparece aqui &mdash; sozinha.</p>';
  const marca = logo
    ? `<img class="logo" src="${logo}" alt="PikPok" draggable="false">`
    : '<div class="logo fallback">P</div>';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>PikPok</title><style>
  html,body{margin:0;height:100%;color:#fff;font-family:'Segoe UI',system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;text-align:center;-webkit-user-select:none;overflow:hidden;
    background:#0a0a0e}
  body{animation:surgir .35s ease both}
  @keyframes surgir{from{opacity:0}to{opacity:1}}
  /* O fundo respira de leve nas duas cores da marca, cada blob no seu tempo. */
  .fundo{position:fixed;inset:-20%;pointer-events:none}
  .fundo::before,.fundo::after{content:'';position:absolute;width:60vmax;height:60vmax;border-radius:50%;
    filter:blur(90px);opacity:.16;animation:flutuar 14s ease-in-out infinite alternate}
  .fundo::before{background:#FE2C55;top:-18vmax;right:-12vmax}
  .fundo::after{background:#00C2BB;bottom:-22vmax;left:-14vmax;animation-duration:18s;animation-delay:-6s}
  @keyframes flutuar{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(6vmax,4vmax,0) scale(1.15)}}

  .caixa{position:relative;display:flex;flex-direction:column;align-items:center;gap:22px;padding:24px;
    animation:chegar .7s cubic-bezier(.2,.8,.2,1) both}
  @keyframes chegar{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

  /* O palco da logo: anel cônico girando por trás, halo pulsando por baixo. */
  .palco{position:relative;width:168px;height:168px;display:flex;align-items:center;justify-content:center}
  .anel{position:absolute;inset:0;border-radius:50%;
    background:conic-gradient(from 0deg,transparent 0 62%,rgba(254,44,85,.9) 78%,rgba(0,194,187,.9) 96%,transparent 100%);
    -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px));
    animation:girar 2.8s linear infinite}
  .anel.lento{inset:14px;animation-duration:4.6s;animation-direction:reverse;opacity:.5}
  @keyframes girar{to{transform:rotate(360deg)}}
  .halo{position:absolute;inset:26px;border-radius:36px;background:linear-gradient(135deg,#FE2C55,#00C2BB);
    filter:blur(26px);opacity:.5;animation:respirar 3.2s ease-in-out infinite}
  @keyframes respirar{0%,100%{opacity:.35;transform:scale(.94)}50%{opacity:.6;transform:scale(1.05)}}
  .logo{position:relative;width:104px;height:104px;border-radius:30px;object-fit:cover;
    box-shadow:0 18px 48px rgba(0,0,0,.55)}
  .logo.fallback{display:flex;align-items:center;justify-content:center;font-size:46px;font-weight:800;
    background:linear-gradient(135deg,#FE2C55,#00C2BB)}

  h1{font-size:23px;margin:0;font-weight:800;letter-spacing:-.3px}
  h1 .vivo{background:linear-gradient(90deg,#FE2C55,#00C2BB);-webkit-background-clip:text;color:transparent}
  .pontos::after{content:'';animation:pontos 1.6s steps(4,end) infinite}
  @keyframes pontos{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}
  .sub{margin:0;max-width:420px;color:rgba(255,255,255,.6);font-size:14px;line-height:1.6}
  .aviso{margin:0;max-width:440px;color:#ffd166;font-size:14px;line-height:1.6;
    border:1px solid rgba(255,209,102,.35);border-radius:12px;padding:12px 16px;background:rgba(255,209,102,.08)}

  /* A linha de status: o traço varre em loop, dizendo "estou vigiando". */
  .vigia{width:220px;height:3px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
  .vigia::before{content:'';display:block;width:38%;height:100%;border-radius:99px;
    background:linear-gradient(90deg,#FE2C55,#00C2BB);animation:varrer 1.9s cubic-bezier(.45,0,.55,1) infinite}
  @keyframes varrer{0%{transform:translateX(-110%)}100%{transform:translateX(390%)}}
  </style></head><body>
  <div class="fundo"></div>
  <div class="caixa">
    <div class="palco">
      <div class="halo"></div>
      <div class="anel"></div>
      <div class="anel lento"></div>
      ${marca}
    </div>
    <h1>Aguardando sua <span class="vivo">live</span><span class="pontos"></span></h1>
    ${recado}
    <div class="vigia"></div>
  </div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * O chat da live simulada: uma coluna de mensagens no estilo do chat do
 * TikTok, alimentada pelo processo principal via `window.__pikpokChat`.
 *
 * As respostas da IA entram NO MEIO das perguntas, destacadas com a marca —
 * é a cena que a simulação existe para mostrar: o copiloto respondendo o chat
 * em tempo real. Tudo num data URL, com o script embutido; nenhuma rede.
 */
function paginaDeChatSimulado(logo: string | null, video: string | null): string {
  const marca = logo
    ? `<img class="logo" src="${logo}" alt="" draggable="false">`
    : '<div class="logo fallback">P</div>';
  const videoUrl = video ? pathToFileURL(video).toString() : null;
  const fundoVideo = videoUrl
    ? `<video class="palco-video" src="${videoUrl}" autoplay muted loop playsinline></video><div class="veu"></div>`
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>PikPok</title><style>
  html,body{margin:0;height:100%;background:#0a0a0e;color:#fff;font-family:'Segoe UI',system-ui,sans-serif;
    -webkit-user-select:none;overflow:hidden}
  body{animation:surgir .35s ease both}
  @keyframes surgir{from{opacity:0}to{opacity:1}}
  /* O "vídeo da live" ocupa a tela toda; o chat flutua por cima, como no
     TikTok. O véu escurece a base para o texto continuar legível. */
  .palco-video{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
  .veu{position:fixed;inset:0;z-index:1;pointer-events:none;
    background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,transparent 22%),
      linear-gradient(0deg,rgba(0,0,0,.7) 0%,transparent 45%),
      linear-gradient(90deg,rgba(0,0,0,.45) 0%,transparent 55%)}
  .topo,#chat{position:relative;z-index:2}
  .msg .texto{text-shadow:0 1px 3px rgba(0,0,0,.8)}
  .topo{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08);
    background:rgba(255,255,255,.03)}
  .logo{width:30px;height:30px;border-radius:9px;object-fit:cover}
  .logo.fallback{display:flex;align-items:center;justify-content:center;font-weight:800;
    background:linear-gradient(135deg,#FE2C55,#00C2BB)}
  .aovivo{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:#FE2C55;
    text-transform:uppercase;letter-spacing:.06em}
  .aovivo::before{content:'';width:8px;height:8px;border-radius:50%;background:#FE2C55;
    animation:piscar 1.4s ease-in-out infinite}
  @keyframes piscar{0%,100%{opacity:1}50%{opacity:.25}}
  .rotulo{font-size:12px;color:rgba(255,255,255,.5);margin-left:auto}
  /* Duas faixas, sem sobreposição: o vídeo ocupa os 65% de cima, limpo, e o
     chat vive numa área DEDICADA nos 35% de baixo. Chat por cima do vídeo
     polui a imagem que o vendedor está olhando; separar é o que deixa os dois
     legíveis. Sem o arquivo de vídeo o palco fica escuro, mas a divisão é a
     mesma. */
  :root{--video:65vh}
  .palco-video{position:fixed;top:0;left:0;right:0;height:var(--video);width:100%;object-fit:cover;z-index:0}
  .veu{display:none}
  /* A divisória é arrastável: o vendedor decide quanto de vídeo e quanto de
     chat quer ver, e a proporção fica guardada no navegador da view. */
  #divisor{position:absolute;top:var(--video);left:0;right:0;height:10px;margin-top:-5px;z-index:3;
    cursor:row-resize;background:transparent}
  #divisor::after{content:'';position:absolute;left:50%;top:3px;width:56px;height:4px;margin-left:-28px;
    border-radius:2px;background:rgba(255,255,255,.28)}
  #divisor:hover::after,body.arrastando #divisor::after{background:#00C2BB}
  body.arrastando{cursor:row-resize;-webkit-user-select:none}
  #chat{position:absolute;top:var(--video);bottom:0;left:0;right:0;overflow-y:auto;padding:12px 16px 14px;
    display:flex;flex-direction:column;gap:8px;
    background:#0b0b10;border-top:1px solid rgba(255,255,255,.08)}
  #chat::-webkit-scrollbar{width:8px}
  #chat::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:4px}
  /* Empurra as mensagens para o fim quando são poucas, sem quebrar a rolagem. */
  #chat::before{content:'';flex:1 0 auto}
  #voltar{position:absolute;right:16px;bottom:14px;z-index:4;display:none;padding:6px 12px;border-radius:999px;
    border:1px solid rgba(255,255,255,.2);background:rgba(16,16,24,.9);color:#fff;font-size:12px;cursor:pointer}
  #voltar.visivel{display:block}
  .topo{position:absolute;top:0;left:0;right:0;z-index:2}
  #chat::-webkit-scrollbar{width:0}
  .msg{display:flex;gap:9px;align-items:flex-start;animation:entrar .3s cubic-bezier(.2,.8,.2,1) both}
  @keyframes entrar{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .avatar{width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;
    justify-content:center;font-size:13px;font-weight:800;color:#fff}
  .corpo{min-width:0}
  .autor{font-size:12px;color:rgba(255,255,255,.5);margin-bottom:2px}
  .texto{font-size:14px;line-height:1.45;word-wrap:break-word}
  .msg.ia .avatar{border-radius:9px;background:linear-gradient(135deg,#FE2C55,#00C2BB)}
  .msg.ia .corpo{background:linear-gradient(#101018,#101018) padding-box,
    linear-gradient(135deg,#FE2C55,#00C2BB) border-box;border:1px solid transparent;
    border-radius:12px;padding:8px 12px}
  .msg.ia .autor{background:linear-gradient(90deg,#FE2C55,#00C2BB);-webkit-background-clip:text;
    color:transparent;font-weight:800}
  ${videoUrl ? '.topo{background:rgba(10,10,14,.55);backdrop-filter:blur(6px)}' : ''}
  </style></head><body>
  ${fundoVideo}
  <div class="topo">${marca}<span class="aovivo">ao vivo</span><span class="rotulo">live simulada · o chat é de mentira, a IA é de verdade</span></div>
  <div id="divisor" title="Arraste para mudar o tamanho do vídeo e do chat"></div>
  <div id="chat"></div>
  <button id="voltar" type="button">↓ novas mensagens</button>
  <script>
  (function(){
    var chat=document.getElementById('chat');
    var divisor=document.getElementById('divisor');
    var voltar=document.getElementById('voltar');
    // A proporção vídeo/chat sobrevive à reabertura: é preferência de layout.
    try{var salvo=localStorage.getItem('pikpok.sim.video');if(salvo)document.documentElement.style.setProperty('--video',salvo+'%')}catch(e){}
    var arrastando=false;
    divisor.addEventListener('mousedown',function(e){arrastando=true;document.body.classList.add('arrastando');e.preventDefault()});
    window.addEventListener('mousemove',function(e){if(!arrastando)return;
      var pct=Math.min(85,Math.max(30,e.clientY/window.innerHeight*100));
      document.documentElement.style.setProperty('--video',pct+'%');});
    window.addEventListener('mouseup',function(){if(!arrastando)return;arrastando=false;document.body.classList.remove('arrastando');
      try{localStorage.setItem('pikpok.sim.video',parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--video')))}catch(e){}});
    // Rolagem livre: só gruda no fim se o leitor JÁ estava no fim. Quem subiu
    // para reler uma pergunta não é puxado de volta a cada mensagem nova.
    function noFim(){return chat.scrollHeight-chat.scrollTop-chat.clientHeight<40}
    chat.addEventListener('scroll',function(){if(noFim())voltar.classList.remove('visivel')});
    voltar.addEventListener('click',function(){chat.scrollTop=chat.scrollHeight;voltar.classList.remove('visivel')});
    function corDe(nome){var h=0;for(var i=0;i<nome.length;i++){h=(h*31+nome.charCodeAt(i))%360}
      return 'hsl('+h+',55%,42%)'}
    window.__pikpokChat=function(item){
      var linha=document.createElement('div');linha.className='msg'+(item.ia?' ia':'');
      var av=document.createElement('div');av.className='avatar';
      av.textContent=item.ia?'IA':(item.autor||'?').charAt(0).toUpperCase();
      if(!item.ia)av.style.background=corDe(item.autor||'?');
      var corpo=document.createElement('div');corpo.className='corpo';
      var autor=document.createElement('div');autor.className='autor';
      autor.textContent=item.autor||'PikPok IA';
      var texto=document.createElement('div');texto.className='texto';texto.textContent=item.texto;
      corpo.appendChild(autor);corpo.appendChild(texto);
      var estavaNoFim=noFim();
      linha.appendChild(av);linha.appendChild(corpo);chat.appendChild(linha);
      while(chat.children.length>200)chat.removeChild(chat.firstChild);
      if(estavaNoFim)chat.scrollTop=chat.scrollHeight;else voltar.classList.add('visivel');
    };
  })();
  </script></body></html>`;
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
