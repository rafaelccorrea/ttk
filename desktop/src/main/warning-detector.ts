import type { WebContents } from 'electron';

/**
 * O detector de aviso/restrição do TikTok.
 *
 * O TikTok não expõe evento de moderação no webcast — o aviso ("seu conteúdo
 * pode violar as diretrizes...") só existe como banner/modal na tela do
 * criador. Este módulo varre a BrowserView da live periodicamente com a
 * cascata de seletores servida pelo backend (`ConfigDeEnvio.seletores.aviso`)
 * e, ao encontrar, avisa o copiloto — que PAUSA o envio e notifica o vendedor;
 * encerrar a live automaticamente é opt-in (`encerrarAoDetectarAviso`).
 *
 * O custo dos dois erros é assimétrico e o desenho segue isso: um aviso não
 * detectado deixa o vendedor exatamente onde ele estaria sem o produto (o
 * banner continua na tela dele); um falso positivo pausa a venda no meio da
 * live. Por isso a varredura é conservadora, deduplicada por assinatura e
 * NUNCA encerra nada sem o opt-in.
 */

/** O que a varredura devolve de dentro da página. */
export interface ResultadoDaDeteccao {
  encontrado: boolean;
  seletorUsado: string | null;
  /** Texto do banner, já truncado DENTRO da página — nunca HTML. */
  textoResumo: string;
}

/** De quanto em quanto tempo a live é varrida à procura do banner. */
export const INTERVALO_DE_VARREDURA_MS = 15_000;

/**
 * O script injetado na BrowserView. AUTOCONTIDO por obrigação: viaja como
 * string para `executeJavaScript`, então nada de imports nem closures — a
 * cascata entra serializada. Seletor inválido (env mal escrito) é pulado em
 * vez de derrubar a varredura inteira.
 */
export function scriptDeDeteccao(seletores: string[]): string {
  return `(() => {
    const seletores = ${JSON.stringify(seletores)};
    for (const seletor of seletores) {
      let el = null;
      try { el = document.querySelector(seletor); } catch { continue; }
      if (!el) continue;
      const texto = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
      return { encontrado: true, seletorUsado: seletor, textoResumo: texto };
    }
    return { encontrado: false, seletorUsado: null, textoResumo: '' };
  })()`;
}

/**
 * O script do clique de ENCERRAR — só roda com o opt-in ligado. Devolve o que
 * tentou, para o log e para a telemetria de seletor quando nada casa.
 */
export function scriptDeEncerrar(seletores: string[]): string {
  return `(() => {
    const seletores = ${JSON.stringify(seletores)};
    for (const seletor of seletores) {
      let el = null;
      try { el = document.querySelector(seletor); } catch { continue; }
      if (!el) continue;
      try { el.click(); } catch { continue; }
      return { ok: true, seletorUsado: seletor };
    }
    return { ok: false, seletorUsado: null };
  })()`;
}

/**
 * A identidade de UM aviso, para o debounce: o mesmo banner na tela não pode
 * virar um alerta a cada varredura de 15s.
 */
export function assinaturaDoAviso(
  seletorUsado: string | null,
  textoResumo: string,
): string {
  return `${seletorUsado ?? ''}::${textoResumo}`;
}

/** Reporta só quando a assinatura MUDOU — banner novo ou texto novo. */
export function deveReportar(
  assinaturaAnterior: string | null,
  assinaturaAtual: string,
): boolean {
  return assinaturaAnterior !== assinaturaAtual;
}

export class DetectorDeAviso {
  private timer: NodeJS.Timeout | null = null;
  private ultimaAssinatura: string | null = null;

  constructor(
    private readonly deps: {
      /** A BrowserView da live — função porque ela morre e renasce. */
      webContents: () => WebContents | null;
      /** A cascata vigente (vem do backend; pode mudar entre lives). */
      seletores: () => string[];
      /** Chamado UMA vez por aviso novo (debounce por assinatura). */
      aoDetectar: (aviso: { seletorUsado: string; textoResumo: string }) => void;
      intervaloMs?: number;
    },
  ) {}

  iniciar(): void {
    if (this.timer) return;
    this.ultimaAssinatura = null;
    this.timer = setInterval(() => {
      void this.varrer();
    }, this.deps.intervaloMs ?? INTERVALO_DE_VARREDURA_MS);
    this.timer.unref?.();
  }

  parar(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.ultimaAssinatura = null;
  }

  /**
   * Uma passada. Erro aqui morre calado de propósito: a varredura é proteção
   * extra, e derrubar o copiloto por causa dela inverteria a hierarquia — o
   * produto principal é responder o chat.
   */
  private async varrer(): Promise<void> {
    const conteudo = this.deps.webContents();
    if (!conteudo || conteudo.isDestroyed()) return;
    try {
      const resultado = (await conteudo.executeJavaScript(
        scriptDeDeteccao(this.deps.seletores()),
        true,
      )) as ResultadoDaDeteccao;
      if (!resultado?.encontrado || !resultado.seletorUsado) {
        // Banner sumiu: o próximo que aparecer é um aviso NOVO.
        this.ultimaAssinatura = null;
        return;
      }
      const assinatura = assinaturaDoAviso(
        resultado.seletorUsado,
        resultado.textoResumo,
      );
      if (!deveReportar(this.ultimaAssinatura, assinatura)) return;
      this.ultimaAssinatura = assinatura;
      this.deps.aoDetectar({
        seletorUsado: resultado.seletorUsado,
        textoResumo: resultado.textoResumo,
      });
    } catch {
      // Página no meio de navegação, view congelada: tenta na próxima.
    }
  }
}
