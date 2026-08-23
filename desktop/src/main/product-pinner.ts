import type { WebContents } from 'electron';

/**
 * O pin de produto na live — 100% BEST-EFFORT.
 *
 * O painel de produtos do TikTok Shop é a parte mais instável da interface
 * deles (varia por região e por teste A/B), então o contrato aqui é honesto:
 * o app TENTA fixar, devolve o desfecho para a tela ("não consegui — fixe
 * manualmente") e reporta a cascata quebrada na telemetria. Nada aqui bloqueia
 * o copiloto: responder o chat continua sendo o produto.
 *
 * O produto é localizado pelo TÍTULO, não por índice: a lista do painel muda
 * de ordem conforme o TikTok reordena por desempenho, e fixar "o terceiro"
 * fixaria o produto errado — que é pior que não fixar.
 */

export interface ResultadoDoPin {
  ok: boolean;
  /** Onde parou: `painel_produtos` | `botao_pin` | `produto` | `clique`. */
  etapaFalhou: string | null;
}

/** Minúsculas, sem acento, espaços colapsados — comparação de gente apressada. */
export function normalizarTitulo(titulo: string): string {
  return (titulo || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** O texto do item do painel contém o título do produto? */
export function tituloBate(textoDoItem: string, tituloAlvo: string): boolean {
  const alvo = normalizarTitulo(tituloAlvo);
  if (!alvo) return false;
  return normalizarTitulo(textoDoItem).includes(alvo);
}

/**
 * O script injetado. AUTOCONTIDO (viaja como string para `executeJavaScript`):
 * a normalização de título é DUPLICADA aqui dentro de propósito — o script não
 * pode fechar sobre `normalizarTitulo`, e um import quebraria a serialização.
 */
export function scriptDePin(
  seletoresPainel: string[],
  seletoresPin: string[],
  tituloAlvo: string,
): string {
  return `(() => {
    const normaliza = (t) => (t || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .replace(/\\s+/g, ' ')
      .trim();
    const alvo = normaliza(${JSON.stringify(tituloAlvo)});
    if (!alvo) return { ok: false, etapaFalhou: 'produto' };

    let painel = null;
    for (const s of ${JSON.stringify(seletoresPainel)}) {
      try { painel = document.querySelector(s); } catch { continue; }
      if (painel) break;
    }
    const escopo = painel || document;

    let botoes = [];
    for (const s of ${JSON.stringify(seletoresPin)}) {
      try { botoes = Array.from(escopo.querySelectorAll(s)); } catch { continue; }
      if (botoes.length) break;
    }
    if (!botoes.length) {
      return { ok: false, etapaFalhou: painel ? 'botao_pin' : 'painel_produtos' };
    }

    for (const botao of botoes) {
      const item = botao.closest('li,[role="listitem"]') || botao.parentElement;
      const texto = normaliza(item ? item.textContent : '');
      if (!texto.includes(alvo)) continue;
      try { botao.click(); } catch { return { ok: false, etapaFalhou: 'clique' }; }
      return { ok: true, etapaFalhou: null };
    }
    return { ok: false, etapaFalhou: 'produto' };
  })()`;
}

/** O próximo da fila circular; −1 quando não há o que girar. */
export function proximoIndice(atual: number, total: number): number {
  if (total <= 0) return -1;
  return (atual + 1) % total;
}

/** De quanto em quanto tempo o rotador CONFERE se é hora de girar. */
export const TICK_DA_ROTACAO_MS = 30_000;

/**
 * A rotação automática de produto: fixa o PRÓXIMO da base a cada intervalo.
 *
 * Round-robin deliberado, não "por conversão": não temos venda por produto em
 * tempo real, e fingir uma priorização que o dado não sustenta é pior que
 * girar a fila às claras. O relógio é do intervalo configurado, mas o timer
 * bate a cada 30s — é assim que ligar/desligar e mudar o intervalo NO MEIO da
 * live valem sem recriar nada.
 *
 * Três falhas seguidas param a rotação: se o painel do TikTok mudou, insistir
 * a cada dez minutos é martelar um seletor morto — melhor avisar e devolver o
 * controle ao vendedor. Como todo o pin, é best-effort e nunca trava o resto.
 */
export class RotadorDeProdutos {
  private timer: NodeJS.Timeout | null = null;
  private indice = -1;
  private ultimaTroca = 0;
  private falhasSeguidas = 0;

  constructor(
    private readonly deps: {
      /** O interruptor, lido a cada batida — a config muda no meio da live. */
      ativa: () => boolean;
      intervaloMs: () => number;
      /** Títulos da base conectada, na ordem em que devem girar. */
      titulos: () => Promise<string[]>;
      fixar: (titulo: string) => Promise<{ ok: boolean }>;
      aoParar?: (motivo: string) => void;
      tickMs?: number;
    },
  ) {}

  iniciar(): void {
    if (this.timer) return;
    this.ultimaTroca = Date.now();
    this.timer = setInterval(
      () => void this.tick(),
      this.deps.tickMs ?? TICK_DA_ROTACAO_MS,
    );
    this.timer.unref?.();
  }

  parar(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposto para os testes dirigirem o relógio sem esperar de verdade. */
  async tick(agora: number = Date.now()): Promise<void> {
    if (!this.deps.ativa()) {
      // Desligada não acumula atraso: religar não dispara um pin imediato.
      this.ultimaTroca = agora;
      return;
    }
    if (agora - this.ultimaTroca < this.deps.intervaloMs()) return;

    const titulos = await this.deps.titulos().catch(() => [] as string[]);
    if (!titulos.length) return;

    this.indice = proximoIndice(this.indice, titulos.length);
    this.ultimaTroca = agora;

    const resultado = await this.deps
      .fixar(titulos[this.indice])
      .catch(() => ({ ok: false }));
    if (resultado.ok) {
      this.falhasSeguidas = 0;
      return;
    }
    this.falhasSeguidas += 1;
    if (this.falhasSeguidas >= 3) {
      this.parar();
      this.deps.aoParar?.(
        'Três produtos seguidos falharam ao fixar — a rotação automática foi pausada. Fixe manualmente e religue nas configurações quando quiser.',
      );
    }
  }
}

/** Executa a tentativa na BrowserView. Erro de execução vira desfecho, não crash. */
export async function fixarProduto(
  conteudo: WebContents | null,
  seletoresPainel: string[],
  seletoresPin: string[],
  tituloAlvo: string,
): Promise<ResultadoDoPin> {
  if (!conteudo || conteudo.isDestroyed()) {
    return { ok: false, etapaFalhou: 'painel_produtos' };
  }
  try {
    return (await conteudo.executeJavaScript(
      scriptDePin(seletoresPainel, seletoresPin, tituloAlvo),
      true,
    )) as ResultadoDoPin;
  } catch {
    return { ok: false, etapaFalhou: 'clique' };
  }
}
