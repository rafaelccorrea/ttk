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
    return paginaDeEspera(this.aviso);
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
function paginaDeEspera(aviso: string | null): string {
  const recado = aviso
    ? `<p class="aviso">${escapar(aviso)}</p>`
    : '<p class="sub">Assim que você entrar ao vivo no TikTok, ela aparece aqui.</p>';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>PikPok</title><style>
  html,body{margin:0;height:100%;background:#0c0c10;color:#fff;font-family:'Segoe UI',system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;text-align:center;-webkit-user-select:none}
  .caixa{display:flex;flex-direction:column;align-items:center;gap:18px;padding:24px}
  .pulso{width:96px;height:96px;border-radius:28px;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#FE2C55,#00C2BB);box-shadow:0 0 0 0 rgba(254,44,85,.45);
    animation:pulso 2.2s ease-out infinite;font-size:40px;font-weight:800;letter-spacing:-2px}
  @keyframes pulso{0%{box-shadow:0 0 0 0 rgba(254,44,85,.45)}70%{box-shadow:0 0 0 34px rgba(254,44,85,0)}100%{box-shadow:0 0 0 0 rgba(254,44,85,0)}}
  h1{font-size:22px;margin:0;font-weight:800}
  .sub{margin:0;max-width:420px;color:rgba(255,255,255,.65);font-size:14px;line-height:1.6}
  .aviso{margin:0;max-width:440px;color:#ffd166;font-size:14px;line-height:1.6;
    border:1px solid rgba(255,209,102,.35);border-radius:12px;padding:12px 16px;background:rgba(255,209,102,.08)}
  .pontos::after{content:'';animation:pontos 1.6s steps(4,end) infinite}
  @keyframes pontos{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}
  </style></head><body><div class="caixa">
    <div class="pulso">P</div>
    <h1>Aguardando sua live<span class="pontos"></span></h1>
    ${recado}
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
