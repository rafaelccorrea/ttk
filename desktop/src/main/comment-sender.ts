import type { WebContents } from 'electron';

/**
 * O envio da resposta no chat da live — o coração da fase 2.
 *
 * Até aqui o copiloto só ESCREVIA na tela do vendedor. Esta classe é o ponto em
 * que o app passa a agir dentro do tiktok.com em nome dele, e por isso ela é
 * escrita mais como um freio do que como um motor: quase todo o código abaixo
 * existe para NÃO enviar — cooldown, teto por minuto, deduplicação, conferência
 * de entrega, kill switch. Enviar é a parte fácil.
 *
 * O RISCO, DITO SEM EUFEMISMO
 * ---------------------------
 * Postar comentário de forma automatizada viola os Termos do TikTok e pode
 * custar a conta do vendedor. O dono do produto aceitou esse risco e o usuário
 * aceita o termo antes de ligar (`live-config.service.ts`), mas a consequência
 * recai sobre a conta DELE, na live DELE. Toda decisão daqui é enviesada para o
 * lado de perder uma resposta em vez de parecer um bot: cadência lenta e
 * irregular, uma mensagem por vez, nenhuma tentativa de contornar verificação.
 *
 * NÃO ACRESCENTE atalho que aumente essa superfície — múltiplas sessões, proxy,
 * repetição agressiva em falha, resposta a captcha. O ganho seria marginal e o
 * custo é a conta de um cliente pagante.
 *
 * A FRONTEIRA DE SEGURANÇA QUE NÃO SE NEGOCIA
 * -------------------------------------------
 * O script que este arquivo injeta roda no contexto de tiktok.com — um site de
 * TERCEIRO, cheio de JavaScript que não é nosso e que pode mudar a qualquer
 * build. Ele é, por construção, uma função fechada em si mesma: recebe texto e
 * seletores por interpolação, devolve um objeto simples e NÃO conhece o token do
 * vendedor, o `ApiClient`, o IPC nem qualquer ponte do preload. A BrowserView
 * segue sem `preload` (ver `index.ts`), e é isso que garante que qualquer script
 * da página que resolva bisbilhotar `window` não encontre nada nosso lá dentro.
 * Se um dia alguém precisar de mais informação vinda da página, ela sai como
 * VALOR DE RETORNO do `executeJavaScript` — nunca como um canal exposto.
 */

/* -------------------------------------------------------------------------- *
 *  Contratos                                                                  *
 * -------------------------------------------------------------------------- */

/** O recorte de `GET /live/config/envio` que o envio consome. */
export interface ConfigDeEnvio {
  version: number;
  killSwitch: boolean;
  seletores: { campo: string[]; botaoEnviar: string[] };
  limites: {
    cooldownMs: number;
    maxPorMinuto: number;
    maxCaracteres: number;
    verificacaoMs: number;
  };
  mensagem?: string;
}

/** Uma resposta aprovada esperando para ir ao chat. */
export interface PedidoDeEnvio {
  replyId: string;
  texto: string;
  /** O hash do autor da pergunta — nunca o @ dele (ver `tiktok-chat.ts`). */
  authorHash: string;
}

/**
 * O desfecho de uma tentativa.
 *
 * `bloqueada` é separada de `falhou` porque só a segunda é problema: bloqueio é
 * o limite fazendo o trabalho dele (cooldown, texto repetido, link no meio) e
 * vira "não enviei, e está certo"; falha é o TikTok tendo engolido a mensagem,
 * que é o que o backend precisa contar para desligar o modo automático.
 */
export type ResultadoDeEnvio =
  | { status: 'enviada' }
  | { status: 'bloqueada'; motivo: string }
  | { status: 'falhou'; motivo: string };

export interface DependenciasDoEnvio {
  /**
   * O `webContents` da BrowserView do TikTok. É uma FUNÇÃO porque a view morre
   * e renasce com a janela: uma referência guardada viraria um objeto destruído
   * no meio da live, e `executeJavaScript` nele estoura.
   */
  webContents: () => WebContents | null;
  /** `GET /live/config/envio`. */
  buscarConfig: () => Promise<ConfigDeEnvio>;
  /** `POST /live/replies/:id/delivery`. */
  confirmarEntrega: (
    replyId: string,
    status: 'enviada' | 'falhou',
    failureReason?: string,
  ) => Promise<void>;
  /** `POST /live/telemetry/selector-failure` — HTML já capturado, sem chat. */
  reportarFalhaDeSeletor: (html: string, version: number) => Promise<void>;
  /**
   * O app caiu sozinho para somente-painel. Quem recebe isto é o `Copiloto`,
   * que avisa a tela e para de pedir envio.
   */
  aoCairParaPainel: (motivo: string) => void;
}

/* -------------------------------------------------------------------------- *
 *  Constantes de política local                                               *
 * -------------------------------------------------------------------------- */

/**
 * A configuração de partida.
 *
 * Ela existe para o app nunca ficar sem política: se a primeira busca ao backend
 * falhar (vendedor abriu o app com a internet ruim, que é o normal em live pelo
 * celular compartilhado), o envio ainda tem cooldown e teto. Os valores repetem
 * os do `live-config.service.ts` de propósito — o padrão local tem que ser tão
 * conservador quanto o remoto, ou a queda de rede viraria o caminho de burlar os
 * limites.
 */
const CONFIG_PADRAO: ConfigDeEnvio = {
  version: 0,
  killSwitch: false,
  seletores: {
    campo: ['[data-e2e="comment-text-input"]', '[data-e2e="comment-input"]'],
    botaoEnviar: ['[data-e2e="comment-post"]'],
  },
  limites: {
    cooldownMs: 8_000,
    maxPorMinuto: 6,
    maxCaracteres: 140,
    verificacaoMs: 4_000,
  },
};

/** De quanto em quanto tempo a política é rebuscada (inclui o kill switch). */
const INTERVALO_CONFIG_MS = 60_000;

/**
 * Duas respostas para a MESMA pessoa em menos de 30 segundos é conversa de bot.
 *
 * O caso real não é malícia do nosso lado: o espectador manda "quanto custa?" e
 * logo depois "e o frete?", o backend gera duas respostas boas e o app dispara
 * as duas seguidas. Para quem olha o chat — e para qualquer heurística — isso é
 * uma conta respondendo a um usuário específico em rajada.
 */
const INTERVALO_MESMO_AUTOR_MS = 30_000;

/**
 * Quantas falhas de LOCALIZAÇÃO seguidas derrubam o envio.
 *
 * Só falha de localização conta. Um envio que não confirmou pode ser moderação,
 * lag do webcast ou a live tendo acabado — nada disso significa que o app perdeu
 * o campo. Já três buscas seguidas sem achar onde digitar significa uma coisa
 * só: o HTML do TikTok mudou, e insistir a partir daí é digitar às cegas em
 * elemento errado da página de outra pessoa.
 */
const FALHAS_ATE_DEGRADAR = 3;

/** Quanto tempo uma mensagem vista no chat serve para confirmar uma entrega. */
const JANELA_DE_ECO_MS = 30_000;

/**
 * Um preço já escrito pelo backend: "R$ 49,90", "R$ 1.299,00", "R$ 1299,00".
 * O corte não pode parti-lo.
 *
 * O separador de milhar é opcional, e isso corrige um bug real: o padrão antigo
 * exigia o ponto, mas o formatador do backend escrevia "1499,90" sem ele — então
 * em todo produto de quatro dígitos esta guarda simplesmente não via preço, e a
 * frase ia ao chat com o valor apagado no corte. Precisa casar tanto o que o
 * backend emite hoje quanto o que ele emitia antes, porque a resposta pode ter
 * sido gerada por uma versão anterior do servidor e estar na fila.
 */
const PRECO_ESCRITO = /R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}|R\$\s*\d+,\d{2}/g;

/* -------------------------------------------------------------------------- *
 *  O enviador                                                                 *
 * -------------------------------------------------------------------------- */

export class EnviadorDeComentarios {
  private config: ConfigDeEnvio = CONFIG_PADRAO;
  private timerConfig: NodeJS.Timeout | null = null;

  /**
   * O seletor que funcionou da última vez.
   *
   * Cachear vale porque a descoberta varre o DOM inteiro e mede área de cada
   * candidato — caro para rodar a cada oito segundos numa página que também está
   * decodificando vídeo. Mas o cache é REVALIDADO antes de cada envio: o React
   * do TikTok remonta a barra de comentário sozinho (ao trocar de aba, ao
   * reabrir a live), e um seletor que não casa mais precisa ser redescoberto na
   * hora, não na próxima falha.
   */
  private seletorEmCache: string | null = null;

  private ultimoEnvioEm = 0;
  private enviosDaJanela: number[] = [];
  private ultimoTextoEnviado = '';
  private ultimoEnvioPorAutor = new Map<string, number>();

  private falhasDeLocalizacao = 0;
  private somentePainel = false;

  /** Uma tentativa por vez: o cooldown não protege nada se houver concorrência. */
  private enviando = false;

  /**
   * O eco do chat: textos que voltaram pelo `ChatSource`, com a hora.
   *
   * É a memória curta que confirma a entrega. Guardar mais do que a janela seria
   * manter texto de live em memória sem uso — e a poda acontece na leitura, que
   * é onde já se percorre a lista.
   */
  private ecos: Array<{ texto: string; em: number }> = [];

  constructor(private readonly deps: DependenciasDoEnvio) {}

  /** Liga a busca de política. Chamar ao abrir a run em modo `auto`. */
  iniciar(): void {
    this.parar();
    void this.atualizarConfig();
    this.timerConfig = setInterval(() => {
      void this.atualizarConfig();
    }, INTERVALO_CONFIG_MS);
  }

  parar(): void {
    if (this.timerConfig) {
      clearInterval(this.timerConfig);
      this.timerConfig = null;
    }
  }

  /** O app está enviando, ou já degradou para somente-painel? */
  get ativo(): boolean {
    return !this.somentePainel && !this.config.killSwitch;
  }

  /**
   * Toda mensagem lida do chat passa por aqui.
   *
   * O `Copiloto` já recebe o fluxo do webcast; este método só o espelha para o
   * enviador, porque a ÚNICA prova de que o comentário saiu é ele reaparecer no
   * mesmo fluxo que todo mundo vê.
   *
   * `doVendedor` é o que impede confirmação falsa. Comparar só o texto deixava
   * um espectador confirmar a nossa entrega ao repetir a frase — e não é caso
   * hipotético: o público repete o preço no chat toda hora, e nossas respostas
   * são justamente frases sobre preço. A resposta ficava marcada como enviada,
   * o contador subia e o comentário nunca tinha saído.
   *
   * A comparação de autor acontece no `Copiloto`, onde o @ existe, e chega aqui
   * como booleano: o enviador nunca precisa saber de quem é a mensagem, só se
   * foi de quem estamos operando.
   */
  observarMensagem(texto: string, doVendedor = false): void {
    const agora = Date.now();
    this.ecos = this.ecos.filter((e) => agora - e.em < JANELA_DE_ECO_MS);
    if (!doVendedor) return;
    this.ecos.push({ texto: normalizar(texto), em: agora });
  }

  /**
   * Tenta postar uma resposta no chat.
   *
   * O desfecho é SEMPRE confirmado ao backend quando houve tentativa real —
   * inclusive a falha. Uma resposta que fica em `pendente` para sempre é pior
   * que uma marcada como falha: ela some do relatório e o vendedor não descobre
   * que o envio parou de funcionar. Bloqueio por limite não confirma nada: nada
   * foi tentado, e a resposta continua valendo no painel para ele copiar.
   */
  async enviar(pedido: PedidoDeEnvio): Promise<ResultadoDeEnvio> {
    const bloqueio = this.motivoDeBloqueio(pedido);
    if (bloqueio) return { status: 'bloqueada', motivo: bloqueio };

    if (this.enviando) {
      return { status: 'bloqueada', motivo: 'Já existe um envio em andamento.' };
    }

    const texto = this.prepararTexto(pedido.texto);
    if (!texto) {
      return { status: 'bloqueada', motivo: 'Texto vazio depois do preparo.' };
    }

    this.enviando = true;
    try {
      const resultado = await this.tentar(pedido, texto);
      await this.deps
        .confirmarEntrega(
          pedido.replyId,
          resultado.status === 'enviada' ? 'enviada' : 'falhou',
          resultado.status === 'falhou' ? resultado.motivo : undefined,
        )
        // A confirmação é telemetria de desfecho, não parte do envio: se a rede
        // cair aqui, a mensagem JÁ está no chat da live e refazer seria postar
        // duas vezes. Some o erro e segue.
        .catch(() => undefined);
      return resultado;
    } finally {
      this.enviando = false;
    }
  }

  /* ------------------------------------------------------------- os limites */

  /**
   * A autoridade final sobre enviar ou não é DAQUI, do desktop.
   *
   * A política vem do backend porque só ele dá para consertar sem release — mas
   * ela é aplicada aqui, e o app se contém sozinho quando a rede cai. Delegar a
   * decisão ao servidor significaria que um copiloto offline, ou com a chamada
   * de configuração falhando, ficaria sem freio nenhum justamente no cenário em
   * que ninguém está olhando.
   */
  private motivoDeBloqueio(pedido: PedidoDeEnvio): string | null {
    if (this.config.killSwitch) {
      return this.config.mensagem ?? 'Envio automático pausado pelo PikPok.';
    }
    if (this.somentePainel) {
      return 'O app está em modo somente-painel.';
    }

    const agora = Date.now();
    const { cooldownMs, maxPorMinuto } = this.config.limites;

    const desdeUltimo = agora - this.ultimoEnvioEm;
    if (this.ultimoEnvioEm > 0 && desdeUltimo < cooldownMs) {
      return `Em intervalo de segurança (faltam ${Math.ceil((cooldownMs - desdeUltimo) / 1000)}s).`;
    }

    this.enviosDaJanela = this.enviosDaJanela.filter((t) => agora - t < 60_000);
    if (this.enviosDaJanela.length >= maxPorMinuto) {
      return 'Teto de mensagens por minuto atingido.';
    }

    const doAutor = this.ultimoEnvioPorAutor.get(pedido.authorHash) ?? 0;
    if (agora - doAutor < INTERVALO_MESMO_AUTOR_MS) {
      return 'Esta pessoa já foi respondida há pouco.';
    }

    const texto = pedido.texto.trim();
    const proibido = motivoDeConteudoProibido(texto);
    if (proibido) return proibido;

    if (normalizar(texto) === this.ultimoTextoEnviado) {
      // Repetir a mesma frase em sequência é a assinatura de bot mais óbvia que
      // existe, e no chat lido por gente também parece defeito.
      return 'Texto idêntico ao último enviado.';
    }

    return null;
  }

  /**
   * Corta no teto servido pelo backend, sem partir palavra — e SEM TOCAR EM
   * PREÇO.
   *
   * O texto que chega aqui já passou pela substituição do backend e traz o
   * valor real da coluna `priceBrl`. Cortar por caractere pode transformar
   * "R$ 1.299,00" em "R$ 1.29", e aí o app publica, em nome do vendedor, um
   * preço que a loja não pratica. Quando o corte esbarraria num preço, ele
   * recua para antes dele; se o que sobrar tiver perdido um preço que o texto
   * tinha, nada é enviado — a frase pode continuar prometendo um valor que já
   * não está escrito, e isso é caso de painel, não de chat.
   */
  private prepararTexto(bruto: string): string {
    return prepararTextoSeguro(bruto, this.config.limites.maxCaracteres);
  }
  /* ------------------------------------------------------------- a tentativa */

  private async tentar(
    pedido: PedidoDeEnvio,
    texto: string,
  ): Promise<ResultadoDeEnvio> {
    const conteudo = this.deps.webContents();
    if (!conteudo || conteudo.isDestroyed()) {
      return { status: 'falhou', motivo: 'A janela do TikTok não está aberta.' };
    }

    const seletor = await this.localizarCampo(conteudo);
    if (!seletor) {
      return {
        status: 'falhou',
        motivo: 'Não foi possível encontrar o campo de comentário na live.',
      };
    }

    /*
     * O relógio da conferência começa ANTES da digitação: só serve como prova
     * de entrega o eco que apareceu no chat depois deste instante. Os ecos
     * guardados são de até trinta segundos ATRÁS, e sem este piso a frase que um
     * espectador (ou o próprio vendedor) escreveu antes do envio confirmaria a
     * entrega de algo que nunca saiu.
     */
    const inicio = Date.now();
    const digitacao = await this.digitar(conteudo, seletor, texto);
    if (!digitacao.ok) {
      // Achar o campo e não conseguir escrever nele é outro problema (campo
      // desabilitado, live em modo restrito) e por isso NÃO conta para a
      // degradação por seletor — trocar o seletor não resolveria nada.
      return { status: 'falhou', motivo: digitacao.motivo };
    }

    const confirmou = await this.aguardarEco(texto, inicio);
    this.registrarEnvio(pedido, texto);

    if (!confirmou) {
      /*
       * Este é o caso que a fase inteira existe para não esconder: o clique
       * aconteceu, o campo esvaziou, e a mensagem simplesmente não apareceu no
       * chat. O TikTok engole comentário calado — moderação, limite próprio,
       * sessão vencida — e sem esta conferência o painel diria "enviada" para
       * algo que ninguém leu.
       */
      return {
        status: 'falhou',
        motivo: 'A mensagem não apareceu no chat dentro do prazo de conferência.',
      };
    }
    return { status: 'enviada' };
  }

  private registrarEnvio(pedido: PedidoDeEnvio, texto: string): void {
    const agora = Date.now();
    // Conta mesmo quando o eco não veio: a mensagem PODE ter saído, e a dúvida
    // se resolve a favor do freio — cooldown a mais custa uma resposta, cooldown
    // a menos custa cadência de bot.
    this.ultimoEnvioEm = agora;
    this.enviosDaJanela.push(agora);
    this.ultimoTextoEnviado = normalizar(texto);
    this.ultimoEnvioPorAutor.set(pedido.authorHash, agora);

    // O mapa de autores acompanha o tamanho da live; podar aqui evita que uma
    // transmissão de horas acumule um hash por espectador para sempre.
    if (this.ultimoEnvioPorAutor.size > 500) {
      for (const [hash, quando] of this.ultimoEnvioPorAutor) {
        if (agora - quando > INTERVALO_MESMO_AUTOR_MS) {
          this.ultimoEnvioPorAutor.delete(hash);
        }
      }
    }
  }

  /* ------------------------------------------------------------ localização */

  /**
   * Acha o campo de comentário, em cascata, e cacheia o vencedor.
   *
   * NUNCA por classe CSS gerada (`css-1a2b3c-DivInput`): esses nomes mudam a
   * cada build do TikTok e casam por acidente com divs de layout — e digitar no
   * elemento errado da página de outra pessoa é pior do que não digitar.
   */
  private async localizarCampo(conteudo: WebContents): Promise<string | null> {
    if (this.seletorEmCache) {
      const aindaVale = await this.executar<boolean>(
        conteudo,
        `(() => { const e = document.querySelector(${JSON.stringify(this.seletorEmCache)}); return !!e && !!e.getClientRects().length; })()`,
      );
      if (aindaVale) return this.seletorEmCache;
      this.seletorEmCache = null;
    }

    const achado = await this.executar<string | null>(
      conteudo,
      scriptDeDescoberta(this.config.seletores.campo),
    );

    if (achado) {
      this.seletorEmCache = achado;
      this.falhasDeLocalizacao = 0;
      return achado;
    }

    this.falhasDeLocalizacao += 1;
    await this.reportarFalha(conteudo);

    if (this.falhasDeLocalizacao >= FALHAS_ATE_DEGRADAR) {
      /*
       * DEGRADAR, NÃO MORRER.
       *
       * Três buscas seguidas sem achar o campo significa que o TikTok mudou o
       * HTML — e a partir daí não há nada de útil a tentar do lado do app. O que
       * NÃO se faz aqui é encerrar a run: o copiloto continua lendo o chat,
       * gerando a resposta e mostrando no painel, que é o produto da fase 1 e
       * funciona sozinho. O vendedor perde o envio automático e continua com a
       * live inteira de pé, sabendo o que aconteceu.
       */
      this.somentePainel = true;
      this.deps.aoCairParaPainel(
        'O TikTok mudou a tela da live e o PikPok não achou o campo de comentário. ' +
          'O envio automático foi desligado; as respostas continuam aparecendo no painel para você copiar.',
      );
    }
    return null;
  }

  /**
   * Manda o HTML para a telemetria — e SÓ o esqueleto.
   *
   * O container do chat vem cheio de comentário de espectador, que é dado
   * pessoal de gente que nunca foi cliente do PikPok. O backend sanea de novo
   * (ver `sanitizarHtml`), porque payload de cliente não é confiável, mas o
   * corte já começa aqui: o que sai da máquina do vendedor é o mínimo que
   * permite escrever um seletor novo.
   */
  private async reportarFalha(conteudo: WebContents): Promise<void> {
    const html = await this.executar<string>(conteudo, scriptDeEsqueleto());
    if (!html) return;
    await this.deps
      .reportarFalhaDeSeletor(html, this.config.version)
      .catch(() => undefined);
  }

  /* --------------------------------------------------------------- digitação */

  /**
   * Digita e envia dentro da página.
   *
   * POR QUE NÃO `element.value = texto`
   * -----------------------------------
   * Duas razões, e a primeira é que simplesmente não funciona. O campo do TikTok
   * é React: o valor do input vive no estado do componente, e uma atribuição
   * direta é sobrescrita no próximo render — ou, pior, fica na tela e o botão de
   * enviar continua desabilitado, porque o `onChange` nunca disparou. O mesmo
   * vale para o `contenteditable`, onde o Draft.js mantém o próprio modelo do
   * documento e ignora o DOM que ele não escreveu.
   *
   * A segunda é que um campo que passa de vazio a 140 caracteres num único tick,
   * sem nenhum evento de teclado antes, é a assinatura de automação mais barata
   * de detectar que existe. `execCommand('insertText')` produz a mesma sequência
   * de eventos que o navegador produz quando alguém digita — que é o caminho que
   * o React escuta e o mesmo que qualquer telemetria da página vê.
   */
  private async digitar(
    conteudo: WebContents,
    seletor: string,
    texto: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const resultado = await this.executar<{ ok: boolean; motivo?: string }>(
      conteudo,
      scriptDeDigitacao(
        seletor,
        texto,
        this.config.seletores.botaoEnviar,
      ),
    );

    if (!resultado) {
      return { ok: false, motivo: 'A página do TikTok não respondeu à digitação.' };
    }
    if (!resultado.ok) {
      return { ok: false, motivo: resultado.motivo ?? 'Falha ao digitar.' };
    }
    return { ok: true };
  }

  /**
   * Espera a mensagem REAPARECER no chat.
   *
   * A comparação é pelo texto normalizado e não por id porque a mensagem volta
   * pelo webcast com um `msgId` do TikTok que não temos como prever no momento
   * do envio. Comparar texto tem um falso positivo possível — um espectador
   * escrever exatamente a mesma frase nos mesmos quatro segundos —, e ele é
   * aceito: o custo é marcar como entregue algo que quase certamente foi.
   *
   * O QUE NÃO É ACEITÁVEL é casar com o passado. `this.ecos` guarda trinta
   * segundos de chat ANTERIOR ao envio, e sem o piso `desde` a primeira
   * conferência acharia a frase que já estava lá e devolveria `true` no mesmo
   * tick — a resposta viraria "enviada" no backend sem nada ter saído. Por isso
   * só conta o eco com `em >= desde`.
   */
  private aguardarEco(texto: string, desde: number): Promise<boolean> {
    const alvo = normalizar(texto);
    const prazo = Date.now() + this.config.limites.verificacaoMs;

    return new Promise((resolver) => {
      const conferir = (): void => {
        const agora = Date.now();
        if (this.ecos.some((e) => e.texto === alvo && e.em >= desde)) {
          resolver(true);
          return;
        }
        if (agora >= prazo) {
          resolver(false);
          return;
        }
        setTimeout(conferir, 250);
      };
      conferir();
    });
  }

  /* ------------------------------------------------------------------ apoio */

  private async atualizarConfig(): Promise<void> {
    try {
      const nova = await this.deps.buscarConfig();
      const versaoMudou = nova.version !== this.config.version;
      this.config = nova;

      // Seletor novo publicado invalida o cache e zera o contador: a frota que
      // tinha caído para painel por HTML velho volta a tentar sem reinstalar o
      // app, que é o motivo de a configuração ser remota.
      if (versaoMudou) {
        this.seletorEmCache = null;
        this.falhasDeLocalizacao = 0;
        this.somentePainel = false;
      }

      if (nova.killSwitch) {
        /*
         * O kill switch é da FROTA e vale imediatamente: no minuto em que o
         * TikTok apertar a detecção, ninguém está enviando. Ele não encerra
         * nada — só derruba para painel, com a mensagem que o backend escreveu,
         * porque "parou sem explicação" é indistinguível de app quebrado no meio
         * da live de alguém.
         */
        this.deps.aoCairParaPainel(
          nova.mensagem ??
            'O envio automático foi pausado pelo PikPok. As respostas continuam no painel.',
        );
      }
    } catch {
      // Sem rede, a política anterior continua valendo — e ela sempre tem
      // cooldown e teto, porque o padrão local já nasce conservador.
    }
  }

  /**
   * A única porta para dentro da página.
   *
   * `executeJavaScript` devolve o valor serializado do script; qualquer exceção
   * do lado do tiktok.com vira rejeição aqui e é engolida em `null`. O envio
   * nunca pode derrubar o processo principal por causa de um erro do site de
   * outra empresa.
   */
  private async executar<T>(
    conteudo: WebContents,
    script: string,
  ): Promise<T | null> {
    try {
      // `userGesture` ligado: sem ele, o TikTok trata o `focus()` e o clique
      // como programáticos e ignora parte deles.
      return (await conteudo.executeJavaScript(script, true)) as T;
    } catch {
      return null;
    }
  }
}

/** Mesma normalização dos dois lados da comparação de eco. */
export function normalizar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().toLowerCase();
}

/*
 * As duas funções abaixo saíram de dentro da classe SEM MUDAR UMA LINHA da
 * lógica, só para poderem ser chamadas direto pelo teste.
 *
 * Elas são o par de guardas que decide se uma frase pode ir ao chat, e as duas
 * dependiam apenas do texto — nada de `webContents`, de config remota ou do
 * relógio. Presas como método privado, exercitá-las exigia montar uma live
 * inteira de mentira e inferir a decisão pelo desfecho do envio; soltas aqui, a
 * regra que protege o preço do vendedor é verificável por si mesma, que é o
 * mínimo para um cálculo que erra publicando um valor errado em nome dele.
 */

/**
 * Corta no teto servido pelo backend, sem partir palavra — e SEM TOCAR EM
 * PREÇO.
 *
 * O texto que chega aqui já passou pela substituição do backend e traz o
 * valor real da coluna `priceBrl`. Cortar por caractere pode transformar
 * "R$ 1.299,00" em "R$ 1.29", e aí o app publica, em nome do vendedor, um
 * preço que a loja não pratica. Quando o corte esbarraria num preço, ele
 * recua para antes dele; se o que sobrar tiver perdido um preço que o texto
 * tinha, nada é enviado — a frase pode continuar prometendo um valor que já
 * não está escrito, e isso é caso de painel, não de chat.
 */
export function prepararTextoSeguro(bruto: string, limite: number): string {
  const texto = bruto.replace(/\s+/g, ' ').trim();
  if (texto.length <= limite) return texto;

  const precos = texto.match(PRECO_ESCRITO)?.length ?? 0;

  let corte = limite;
  for (const achado of texto.matchAll(PRECO_ESCRITO)) {
    const inicio = achado.index ?? 0;
    if (inicio < corte && inicio + achado[0].length > corte) {
      corte = inicio;
      break;
    }
  }

  const cortado = texto.slice(0, corte);
  const ultimoEspaco = cortado.lastIndexOf(' ');
  // Só volta até o espaço se isso não comer metade da frase: um corte que
  // deixa três palavras é pior que uma palavra partida.
  const final = (
    ultimoEspaco > corte * 0.6 ? cortado.slice(0, ultimoEspaco) : cortado
  )
    .replace(/[\s,;:-]+$/, '')
    .trim();

  if ((final.match(PRECO_ESCRITO)?.length ?? 0) < precos) return '';
  return final;
}

/**
 * Link e @menção saem por dois motivos que se somam: são o gatilho mais
 * clássico de filtro anti-spam do TikTok, e uma resposta gerada que contenha
 * um deles quase certamente veio de conteúdo copiado do chat — ou seja, o
 * app estaria repetindo o link de um terceiro em nome do vendedor.
 */
export function motivoDeConteudoProibido(texto: string): string | null {
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|br|net|io|me|shop)\b/i.test(texto)) {
    return 'A resposta contém link.';
  }
  if (/(^|\s)@\w/.test(texto)) {
    return 'A resposta contém menção a perfil.';
  }
  return null;
}

/* -------------------------------------------------------------------------- *
 *  Os scripts injetados                                                        *
 *                                                                              *
 *  Tudo daqui para baixo é STRING que roda no contexto do tiktok.com. Vale de   *
 *  novo o que está no topo do arquivo: nada aqui recebe token, api, IPC ou      *
 *  ponte de preload, e nada aqui expõe função em `window`. Cada script é uma    *
 *  IIFE que entra por interpolação de literais e sai por valor de retorno.      *
 * -------------------------------------------------------------------------- */

/**
 * A cascata de localização, em três degraus.
 *
 * O retorno é um SELETOR, não o elemento: nada de DOM atravessa a fronteira do
 * processo. Quando o vencedor sai dos degraus (b) ou (c) — onde não existe
 * seletor estável para descrever o achado — o script marca o elemento com um
 * atributo nosso e devolve o seletor desse atributo. A marca some quando o React
 * remonta a barra, o que é justamente o sinal de que é hora de redescobrir.
 */
function scriptDeDescoberta(seletoresDoBackend: string[]): string {
  return `(() => {
    const MARCA = 'data-pikpok-campo';
    const doBackend = ${JSON.stringify(seletoresDoBackend)};

    const visivel = (el) => {
      if (!el || !el.getClientRects().length) return false;
      const est = getComputedStyle(el);
      if (est.visibility === 'hidden' || est.display === 'none') return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 10;
    };

    // (a) O que o backend serve. É a primeira tentativa porque 'data-e2e' é
    //     gancho de teste do próprio TikTok — o atributo que o time de front
    //     deles tem incentivo para não quebrar.
    for (const s of doBackend) {
      try {
        const el = document.querySelector(s);
        if (visivel(el)) return s;
      } catch (e) { /* seletor inválido publicado por engano não derruba a cascata */ }
    }

    const marcar = (el) => {
      document.querySelectorAll('[' + MARCA + ']').forEach((n) => n.removeAttribute(MARCA));
      el.setAttribute(MARCA, '1');
      return '[' + MARCA + '="1"]';
    };

    const candidatos = Array.from(
      document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]')
    ).filter(visivel);

    // (b) Estrutural: entre os campos visíveis, o de MAIOR ÁREA no terço
    //     inferior da tela cujo rótulo fale de comentário. Área e posição juntas
    //     porque a barra de comentário de uma live é, por desenho, o campo grande
    //     embaixo — e o rótulo evita casar com a busca do topo da página.
    const rotulo = /coment|comment|diga algo|say something/i;
    const corte = window.innerHeight * (2 / 3);

    const comRotulo = candidatos
      .map((el) => ({
        el,
        r: el.getBoundingClientRect(),
        texto: (el.getAttribute('placeholder') || '') + ' ' +
               (el.getAttribute('aria-label') || '') + ' ' +
               (el.getAttribute('data-placeholder') || ''),
      }))
      .filter((c) => c.r.top >= corte && rotulo.test(c.texto))
      .sort((a, b) => (b.r.width * b.r.height) - (a.r.width * a.r.height));

    if (comRotulo.length) return marcar(comRotulo[0].el);

    // (c) Heurístico: o focável mais PRÓXIMO do botão de enviar. Vale quando o
    //     TikTok tira o rótulo do campo (acontece em live com o teclado aberto),
    //     e é o último degrau porque proximidade acerta menos que rótulo.
    const botoes = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((b) => visivel(b) && /enviar|send|post/i.test(
        (b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')
      ));

    if (botoes.length && candidatos.length) {
      const alvo = botoes[botoes.length - 1].getBoundingClientRect();
      const centro = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      const c0 = centro(alvo);

      let melhor = null;
      let menor = Infinity;
      for (const el of candidatos) {
        const c = centro(el.getBoundingClientRect());
        const d = Math.hypot(c.x - c0.x, c.y - c0.y);
        if (d < menor) { menor = d; melhor = el; }
      }
      // Longe demais é outro pedaço da página, não o par do botão.
      if (melhor && menor < 600) return marcar(melhor);
    }

    return null;
  })()`;
}

/**
 * Digitação humanizada e envio.
 *
 * O ritmo é log-normal (e não uniforme, nem constante) porque é assim que a
 * digitação humana se distribui: a maioria das teclas sai perto da média e uma
 * minoria demora muito mais — a hesitação, o olhar para a tela. Uma distribuição
 * simétrica produz um traço regular demais; um `setTimeout` fixo produz um
 * intervalo idêntico entre todas as teclas, que é reconhecível num gráfico à
 * primeira vista. As pausas extras depois de espaço e pontuação existem pelo
 * mesmo motivo: gente pensa entre palavras e respira no fim da frase.
 */
function scriptDeDigitacao(
  seletor: string,
  texto: string,
  seletoresDoBotao: string[],
): string {
  return `(async () => {
    const campo = document.querySelector(${JSON.stringify(seletor)});
    if (!campo) return { ok: false, motivo: 'O campo sumiu antes da digitação.' };

    const texto = ${JSON.stringify(texto)};
    const botoes = ${JSON.stringify(seletoresDoBotao)};

    const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

    // Box-Muller: transforma dois uniformes num normal, que a exponencial
    // converte em log-normal. Média 65ms, desvio 25ms, piso de 20ms — abaixo
    // disso nem o datilógrafo mais rápido chega, então seria delator.
    const atraso = () => {
      const u1 = Math.random() || 1e-9;
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const media = 65, desvio = 25;
      const mu = Math.log(media * media / Math.sqrt(desvio * desvio + media * media));
      const sigma = Math.sqrt(Math.log(1 + (desvio * desvio) / (media * media)));
      return Math.max(20, Math.round(Math.exp(mu + sigma * z)));
    };

    const valorDo = (el) =>
      el.isContentEditable ? (el.textContent || '') : (el.value || '');

    try {
      campo.focus();
      if (campo.isContentEditable) {
        // O cursor precisa estar DENTRO do editável: sem seleção posicionada, o
        // 'insertText' não tem onde escrever e o Draft.js descarta a operação.
        const faixa = document.createRange();
        faixa.selectNodeContents(campo);
        faixa.collapse(false);
        const selecao = window.getSelection();
        selecao.removeAllRanges();
        selecao.addRange(faixa);
      }

      for (const ch of Array.from(texto)) {
        const init = { key: ch, bubbles: true, cancelable: true };
        campo.dispatchEvent(new KeyboardEvent('keydown', init));
        campo.dispatchEvent(new KeyboardEvent('keypress', init));
        document.execCommand('insertText', false, ch);
        campo.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch }));
        campo.dispatchEvent(new KeyboardEvent('keyup', init));

        let espera = atraso();
        if (/[\\s.,!?;:]/.test(ch)) espera += 120 + Math.floor(Math.random() * 180);
        await dormir(espera);
      }

      if (valorDo(campo).trim() === '') {
        return { ok: false, motivo: 'O campo continuou vazio depois de digitar.' };
      }

      // Enter primeiro porque é o que a pessoa faz — e é o caminho que a página
      // sempre suporta, mesmo quando o botão está fora da tela.
      const enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      campo.dispatchEvent(new KeyboardEvent('keydown', enter));
      campo.dispatchEvent(new KeyboardEvent('keypress', enter));
      campo.dispatchEvent(new KeyboardEvent('keyup', enter));

      await dormir(400);

      // Campo vazio é o sinal de que a página aceitou o Enter. Continuar cheio
      // significa que este formulário só envia por clique — acontece em parte
      // dos layouts de live —, então o botão é o plano B, e não o caminho
      // padrão: clique sintético é mais visível que tecla.
      if (valorDo(campo).trim() !== '') {
        let clicou = false;
        for (const s of botoes) {
          try {
            const b = document.querySelector(s);
            if (b && b.getClientRects().length) { b.click(); clicou = true; break; }
          } catch (e) { /* seletor inválido: tenta o próximo */ }
        }
        if (!clicou) {
          return { ok: false, motivo: 'O Enter não enviou e o botão não foi encontrado.' };
        }
        await dormir(300);
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: 'Erro ao digitar na página: ' + (e && e.message ? e.message : 'desconhecido') };
    }
  })()`;
}

/**
 * O esqueleto do DOM para a telemetria de falha.
 *
 * NÃO é `outerHTML` filtrado por regex, e a diferença é o ponto do arquivo
 * inteiro: `outerHTML` carrega os ATRIBUTOS, e numa live real são eles que
 * guardam a identidade do espectador — `href="/@fulano"`, `src` do avatar com o
 * id dele, `aria-label`/`title` com o texto do comentário. Apagar só o que está
 * ENTRE as tags deixaria tudo isso viajar pela rede e aparecer em log de proxy.
 *
 * Então o esqueleto é RECONSTRUÍDO nó a nó: nenhum texto atravessa, e de cada
 * elemento só saem os atributos de uma lista fechada — os que descrevem
 * estrutura e servem para escrever um seletor novo —, cada um cortado no
 * comprimento. O servidor sanea de novo (`sanitizarHtml`), porque payload de
 * cliente nunca é confiável, mas o que sai daqui já é o mínimo.
 *
 * E a região é a de BAIXO da tela, que é onde a barra de comentário vive: subir
 * os primeiros 8.000 caracteres do `body` seria subir o topo do DOM e não
 * incluir justamente o elemento que a telemetria existe para diagnosticar.
 */
function scriptDeEsqueleto(): string {
  return `(() => {
    if (!document.body) return '';
    const LIMITE = 8000;
    const corte = window.innerHeight * (2 / 3);

    /*
     * Allowlist de atributos que podem sair COM VALOR.
     *
     * Antes daqui passavam 'id' e qualquer 'data-*', e os dois carregam dado de
     * terceiro no chat do TikTok: 'id' vem como msg-<userId>, e 'data-*' é campo
     * livre da aplicação deles. Nenhum dos dois ajuda a montar seletor — id
     * gerado não se repete entre sessões. Ficam registrados vazios: saber que
     * existem basta, o valor não é nosso.
     *
     * É allowlist e não lista de proibidos porque o HTML é de outra empresa:
     * atributo que eles inventarem amanhã entraria por omissão na regra inversa.
     */
    const comValor = (nome) =>
      nome === 'class' || nome === 'role' || nome === 'type' ||
      nome === 'name' || nome === 'contenteditable' || nome === 'disabled' ||
      nome === 'aria-disabled' || nome === 'data-e2e';

    const registravel = (nome) =>
      comValor(nome) || nome === 'id' || nome === 'aria-label' ||
      nome.indexOf('data-') === 0 || nome.indexOf('aria-') === 0;

    /*
     * O 'aria-label' é o atributo mais útil da amostra (é rótulo de interface, e
     * a cascata procura por ele) e o mais perigoso: nada impede o TikTok de
     * despejar ali o texto da mensagem.
     *
     * A versão anterior mantinha o valor quando ele CONTIVESSE uma palavra de
     * interface — teste de substring, então "Maria: quero comprar, deixei like"
     * passava inteiro, com nome e recado de espectador. Agora não sai valor
     * nenhum: sai só a palavra-chave que casou, entre colchetes. Para escrever
     * um seletor novo o que importa é o elemento SE ANUNCIAR como campo de
     * comentário, não o que está escrito nele.
     */
    const rotulo = /(coment|comment|diga algo|say something|enviar|send|post|buscar|search|curtir|like|compartilhar|share|fechar|close)/i;

    const partes = [];
    let total = 0;
    const emitir = (t) => { if (total < LIMITE) { partes.push(t); total += t.length; } };

    const visitar = (el, nivel) => {
      if (total >= LIMITE || nivel > 14) return;
      const tag = (el.tagName || '').toLowerCase();
      if (!tag || tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'noscript') return;

      const r = el.getBoundingClientRect();
      // Elemento que termina acima do corte é outra parte da página. Os de
      // altura zero passam porque costumam ser containers dos que interessam.
      if (r.height > 0 && r.bottom < corte) return;

      let abre = '<' + tag;
      for (const atributo of Array.from(el.attributes || [])) {
        const nome = String(atributo.name || '').toLowerCase();
        if (!registravel(nome)) continue;
        let valor = '';
        if (nome === 'aria-label') {
          const achado = rotulo.exec(String(atributo.value || ''));
          valor = achado ? '[rotulo:' + achado[1].toLowerCase() + ']' : '';
        } else if (comValor(nome)) {
          valor = String(atributo.value || '').replace(/["<>]/g, '').slice(0, 40);
        }
        abre += ' ' + nome + '="' + valor + '"';
      }
      emitir(abre + '>');
      for (const filho of Array.from(el.children)) visitar(filho, nivel + 1);
      emitir('</' + tag + '>');
    };

    visitar(document.body, 0);
    return partes.join('').slice(0, LIMITE);
  })()`;
}
