import type { WebContents } from 'electron';
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
  private conexao: Pick<EstadoConexao, 'status' | 'tiktokUsername'> = {
    status: 'desconectado',
    tiktokUsername: null,
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
    this.conexao = { status: estado.status, tiktokUsername: estado.tiktokUsername };

    if (estado.status === 'sem_saldo') {
      // O painel também conta, mas é AQUI que o vendedor está olhando — a live
      // sai da tela junto com o motivo, senão parece que o app quebrou.
      this.aviso =
        estado.motivo ??
        'Os minutos acabaram e o copiloto parou de responder. Compre mais horas no site para voltar.';
      this.aoVivo = false;
    } else if (estado.status === 'encerrada' || estado.status === 'erro') {
      this.aviso = estado.motivo;
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
    if (url === 'about:blank' || url.startsWith('data:')) return true;
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
    if (!forcar) {
      if (alvo.startsWith('data:') && atual.startsWith('data:')) return;
      if (!alvo.startsWith('data:') && atual === alvo) return;
    }
    void view.loadURL(alvo).catch(() => undefined);
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

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
