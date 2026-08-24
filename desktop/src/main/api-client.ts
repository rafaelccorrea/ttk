import { hostname } from 'node:os';
import { safeStorage, shell } from 'electron';
import Store from 'electron-store';
import type {
  BaseDeConhecimento,
  CarteiraLive,
  EstadoAtivacao,
  ProdutoDaLive,
  SessaoDesktop,
} from '../shared/desktop-api';
import type {
  ChatMessagePayload,
  LiveEvent,
  LiveRunMode,
} from '../shared/live-events';
import type { ConfigDeEnvio } from './comment-sender';

/**
 * O cliente do backend do PikPok, do lado do desktop.
 *
 * Concentra as quatro coisas que o app faz contra a API: parear o dispositivo
 * (device flow), abrir/encerrar a run, mandar os lotes do chat e bater o
 * heartbeat — mais o consumo do SSE por onde as respostas voltam. Nada disso
 * fica no `index.ts`, porque tudo aqui precisa do token e o token só pode ser
 * lido num lugar.
 */

/**
 * O endereço da API, com o prefixo global incluído.
 *
 * Os dois pedaços são obrigatórios e cada um já esteve errado aqui:
 *
 *  · a ORIGEM — tem de ser a mesma que o `frontend/.env.production` publica.
 *    Um domínio bonito que ninguém registrou faz o app falhar no DNS, e o
 *    sintoma que chega ao suporte é "não conecta", sem nada a que se agarrar.
 *  · o `/api/v1` — o Nest serve tudo sob `setGlobalPrefix('api/v1')`, e as
 *    chamadas daqui montam caminhos como `/live/runs/...`. Sem o prefixo na
 *    base, todas elas viram 404 em produção enquanto funcionam no `dev` de quem
 *    exporta a variável de ambiente com o caminho completo — que é a pior forma
 *    de um erro existir: invisível para quem desenvolve, total para quem instala.
 *
 * `PIKPOK_API_URL` sobrepõe os dois, para apontar o app para outro ambiente.
 */
const API_BASE_PRODUCAO = 'https://ivory-spider-116452.hostingersite.com/api/v1';

/**
 * Em `npm run dev` o padrão é a máquina local, não produção.
 *
 * O caminho contrário — desenvolver contra o servidor de verdade sem ter pedido
 * isso — é como se estraga dado de cliente sem perceber: abre uma run, debita
 * minuto de live e grava mensagem de chat na conta real, tudo a partir de um
 * app que ainda está sendo mexido. O engano é fácil demais para ficar dependendo
 * de alguém lembrar de exportar uma variável (e no PowerShell a forma
 * `VAR=valor comando` nem existe, então esquecer é o comportamento padrão).
 *
 * `electron-vite dev` define NODE_ENV=development; o build empacotado, não.
 */
const API_BASE_PADRAO =
  process.env['NODE_ENV'] === 'development'
    ? 'http://localhost:3000/api/v1'
    : API_BASE_PRODUCAO;
const INTERVALO_POLL_DEVICE_MS = 3_000;
const INTERVALO_HEARTBEAT_MS = 60_000;

/** Backoff da reconexão do SSE, no mesmo formato do chat: 1s a 30s. */
const SSE_BACKOFF_INICIAL_MS = 1_000;
const SSE_BACKOFF_MAXIMO_MS = 30_000;

interface DeviceStartResposta {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}

interface DeviceTokenResposta {
  status: 'pendente' | 'aprovado';
  accessToken?: string;
  expiresIn?: number;
  user?: { id: string; email: string };
}

/** O recorte de `GET /billing/wallet` que o desktop usa. */
interface CarteiraResposta {
  plan: string;
  liveCopilot?: {
    minutes: number;
    trialMinutes: number;
    trialAvailable: boolean;
  };
}

/** Uma linha de `GET /live/sessions` (a entidade crua). */
interface LiveSessionResposta {
  id: string;
  title: string;
  status: string;
  updatedAt: string | null;
}

/** `GET /live/sessions/:id`, que é onde os produtos e o FAQ vêm juntos. */
interface LiveSessionDetalhe extends LiveSessionResposta {
  produtos: unknown[];
  faq: unknown[];
}

/** `GET /live/termo-envio-automatico`. */
interface TermoDeEnvioResposta {
  versao: string;
  texto: string;
  aceito: boolean;
}

/** Uma linha de `GET /live/runs/:id/queue`. */
export interface RespostaNaFila {
  id: string;
  chatMessageId: string;
  /** O hash do autor da pergunta — nunca o @ dele. */
  authorHash: string;
  text: string;
  createdAt: string;
}

export interface LiveRunResumo {
  id: string;
  status: string;
  messagesSeen: number;
  repliesGenerated: number;
  escalations: number;
  minutesCharged: number;
}

/**
 * O disco do app. Guarda SÓ o token cifrado, o e-mail da conta e a URL da API —
 * nada de dado de live, que é do backend.
 */
interface EsquemaDoDisco {
  tokenCifrado?: string;
  email?: string;
  apiBaseUrl?: string;
}

export class ApiClient {
  private readonly disco = new Store<EsquemaDoDisco>({ name: 'pikpok' });

  private token: string | null = null;
  /**
   * Se o disco já foi consultado nesta execução.
   *
   * O TOKEN NÃO PODE SER LIDO NO CONSTRUTOR, e isso já custou uma ativação
   * repetida a cada abertura do app. O `Copiloto` — e portanto este cliente —
   * nasce no topo do módulo do processo principal, que é avaliado ANTES do
   * `app.whenReady()`. Nesse instante o `safeStorage` ainda não tem cifra
   * disponível: `isEncryptionAvailable()` responde `false`, `lerToken()`
   * devolve `null` sem erro nenhum, e o painel abre na tela de ativação com o
   * token válido intacto no `%APPDATA%`, a um palmo de distância.
   *
   * Adiantar o `whenReady` aqui dentro não serve (o construtor é síncrono) e
   * mover a criação do `Copiloto` para dentro do `whenReady` obrigaria todo o
   * registro de IPC a mudar de forma. Ler sob demanda resolve na origem: a
   * primeira consulta ao token acontece quando o painel pergunta pela sessão,
   * que é sempre depois de a janela existir.
   */
  private tokenLido = false;
  private runId: string | null = null;

  private heartbeat: NodeJS.Timeout | null = null;
  private sseAtivo = false;
  private sseAbort: AbortController | null = null;

  /** O token da sessão, lido do disco na primeira vez que alguém precisa. */
  private get tokenAtual(): string | null {
    if (!this.tokenLido) {
      this.tokenLido = true;
      this.token = this.lerToken();
    }
    return this.token;
  }

  get autenticado(): boolean {
    return this.tokenAtual !== null;
  }

  get runAtual(): string | null {
    return this.runId;
  }

  private get baseUrl(): string {
    return (
      process.env['PIKPOK_API_URL'] ??
      this.disco.get('apiBaseUrl') ??
      API_BASE_PADRAO
    );
  }

  // ------------------------------------------------------------ device flow
  /**
   * Pareia o dispositivo: inicia o fluxo, abre o navegador padrão na página de
   * aprovação e fica consultando o token até a pessoa decidir.
   *
   * O navegador do SISTEMA, e não uma janela do Electron: é lá que o vendedor
   * já está logado no PikPok, com o gerenciador de senha dele e o 2FA que ele
   * conhece. Uma tela de login DENTRO do app desktop também treinaria o
   * usuário a digitar a senha do PikPok em qualquer janela que se pareça com a
   * nossa — que é o padrão exato que o device flow existe para eliminar.
   *
   * A chamada RETORNA assim que o código existe, e o polling segue em segundo
   * plano avisando pelo `aoMudar`. Devolver só no fim prenderia a tela por até
   * dez minutos numa promessa — e um `invoke` de IPC pendurado esse tempo todo
   * é indistinguível, do lado do painel, de um app travado.
   *
   * @param aoMudar Recebe cada transição do fluxo (aprovada, expirada, erro).
   */
  async iniciarAtivacao(
    aoMudar: (estado: EstadoAtivacao) => void,
  ): Promise<EstadoAtivacao> {
    const inicio = await this.requisitar<DeviceStartResposta>(
      'POST',
      '/auth/device/start',
      { deviceName: `PikPok Copiloto — ${hostname()}` },
      { autenticado: false },
    );

    const pendente: EstadoAtivacao = {
      status: 'pendente',
      userCode: inicio.userCode,
      verificationUrl: inicio.verificationUrl,
      expiresIn: inicio.expiresIn,
      erro: null,
    };

    // O navegador é aberto sem `await` porque o retorno dele depende do sistema
    // (no Windows ele só resolve quando o shell responde) e a tela não precisa
    // esperar: o código já está visível no painel de qualquer forma.
    void shell.openExternal(inicio.verificationUrl);
    void this.aguardarAprovacao(inicio, pendente, aoMudar);

    return pendente;
  }

  private async aguardarAprovacao(
    inicio: DeviceStartResposta,
    pendente: EstadoAtivacao,
    aoMudar: (estado: EstadoAtivacao) => void,
  ): Promise<void> {
    const limite = Date.now() + inicio.expiresIn * 1_000;

    while (Date.now() < limite) {
      await this.esperar(INTERVALO_POLL_DEVICE_MS);

      try {
        const resposta = await this.requisitar<DeviceTokenResposta>(
          'POST',
          '/auth/device/token',
          { deviceCode: inicio.deviceCode },
          { autenticado: false },
        );

        if (resposta.status === 'aprovado' && resposta.accessToken) {
          this.guardarToken(resposta.accessToken, resposta.user?.email ?? null);
          aoMudar({ ...pendente, status: 'aprovada' });
          return;
        }
      } catch (erro) {
        // O backend responde 400 com texto próprio quando o vendedor RECUSOU no
        // navegador — e recusa é desfecho, não falha de rede: insistir no
        // polling deixaria a tela girando depois de a pessoa já ter decidido.
        const mensagem = this.comoErro(erro).message;
        aoMudar({
          ...pendente,
          status: /recus|neg/i.test(mensagem) ? 'negada' : 'erro',
          erro: mensagem,
        });
        return;
      }
    }

    aoMudar({ ...pendente, status: 'expirada' });
  }

  /** A conta ativada, ou `null` se o app nunca foi pareado. */
  async obterSessao(): Promise<SessaoDesktop | null> {
    if (!this.tokenAtual) return null;
    // O plano vem da carteira, e não de um campo guardado no disco: ele muda na
    // web (assinatura, downgrade, cancelamento) sem o desktop saber, e um plano
    // velho em cache mostraria o cockpit para quem já não tem direito a ele.
    const carteira = await this.requisitar<CarteiraResposta>(
      'GET',
      '/billing/wallet',
    );
    return {
      email: this.disco.get('email') ?? '',
      plano: carteira.plan,
    };
  }

  async obterCarteiraLive(): Promise<CarteiraLive> {
    const carteira = await this.requisitar<CarteiraResposta>(
      'GET',
      '/billing/wallet',
    );
    return {
      minutos: carteira.liveCopilot?.minutes ?? 0,
      trialMinutos: carteira.liveCopilot?.trialMinutes ?? 0,
      trialDisponivel: carteira.liveCopilot?.trialAvailable ?? false,
    };
  }

  /**
   * As bases que dá para colocar no ar.
   *
   * Só as `pronta` sobem para a tela: uma base ainda em transcrição responderia
   * a live com metade do catálogo, e responder errado ao vivo é pior do que não
   * responder. A contagem de produtos e de FAQ obriga a buscar o detalhe de
   * cada uma — a listagem não traz —, o que é aceitável porque isso roda uma vez
   * na tela de conexão, sobre a casa de dezenas de itens, e nunca durante a
   * transmissão.
   */
  async listarBases(): Promise<BaseDeConhecimento[]> {
    const sessoes = await this.requisitar<LiveSessionResposta[]>(
      'GET',
      '/live/sessions',
    );
    const prontas = sessoes.filter((s) => s.status === 'pronta');

    const detalhes = await Promise.all(
      prontas.map((s) =>
        this.requisitar<LiveSessionDetalhe>('GET', `/live/sessions/${s.id}`),
      ),
    );

    return detalhes.map((d) => ({
      id: d.id,
      title: d.title,
      produtos: d.produtos?.length ?? 0,
      faqs: d.faq?.length ?? 0,
      atualizadaEm: d.updatedAt,
    }));
  }

  /**
   * Os nomes dos produtos de uma base, para a live simulada perguntar pelo
   * que EXISTE nela. Perguntas genéricas fazem o motor responder genérico;
   * citando o produto real, a demo mostra o preço da coluna `priceBrl` saindo
   * no chat — que é a cena que vende o produto. Falha vira lista vazia: o
   * simulador tem roteiro genérico de reserva.
   */
  /**
   * Os produtos de uma base, no recorte da lista de "fixar na live" — id e
   * título, nada além: preço e detalhe já vivem no painel da web.
   */
  async listarProdutosDaBase(sessionId: string): Promise<ProdutoDaLive[]> {
    try {
      const detalhe = await this.requisitar<LiveSessionDetalhe>(
        'GET',
        `/live/sessions/${sessionId}`,
      );
      return (detalhe.produtos ?? [])
        .map((p) => {
          const bruto = p as {
            id?: unknown;
            name?: unknown;
            priceBrl?: unknown;
            imageUrl?: unknown;
          };
          // `priceBrl` chega como string (coluna `numeric`) — "89.90".
          const preco = Number(bruto.priceBrl);
          return {
            id: String(bruto.id ?? ''),
            title: String(bruto.name ?? '').trim(),
            priceBrl:
              bruto.priceBrl == null || bruto.priceBrl === '' || !Number.isFinite(preco)
                ? null
                : preco,
            imageUrl: this.urlAbsolutaDeMidia(bruto.imageUrl),
          };
        })
        .filter((p) => p.id && p.title);
    } catch {
      return [];
    }
  }

  /**
   * O banco guarda a foto como caminho RELATIVO (`/api/v1/media/s3/...`, ver
   * `MediaMirrorService`). O renderer não sabe qual é a origem da API — só o
   * main sabe (`baseUrl`) — então a URL sai daqui já absoluta, pronta para o
   * `<img>` do cockpit. Uma URL que já é absoluta (CDN) passa como veio.
   */
  private urlAbsolutaDeMidia(valor: unknown): string | null {
    if (typeof valor !== 'string' || !valor.trim()) return null;
    if (/^https?:\/\//i.test(valor)) return valor;
    try {
      return new URL(valor, new URL(this.baseUrl).origin).toString();
    } catch {
      return null;
    }
  }

  async nomesDeProdutos(sessionId: string): Promise<string[]> {
    try {
      const detalhe = await this.requisitar<LiveSessionDetalhe>(
        'GET',
        `/live/sessions/${sessionId}`,
      );
      return (detalhe.produtos ?? [])
        .map((p) => String((p as { name?: unknown }).name ?? '').trim())
        .filter((nome) => nome.length > 1);
    } catch {
      return [];
    }
  }

  /**
   * Grava o token cifrado pelo `safeStorage`.
   *
   * O `safeStorage` do Electron entrega a cifra ao SISTEMA OPERACIONAL — DPAPI
   * no Windows, Keychain no macOS, o keyring da sessão no Linux — e a chave
   * fica amarrada ao usuário logado. Isso importa porque este token é um JWT de
   * 30 dias da conta inteira do vendedor, não um cookie de sessão: em texto
   * puro dentro de um JSON no `%APPDATA%`, qualquer infostealer que passe por
   * ali (e eles varrem exatamente as pastas de app Electron) sai com acesso à
   * conta, aos dados de venda e ao saldo de créditos. Cifrado pelo SO, o
   * arquivo copiado para outra máquina não abre.
   *
   * Não é criptografia perfeita — código rodando COMO o próprio usuário
   * consegue decifrar, é a natureza do DPAPI. O que ela elimina é o caso comum
   * e barato: leitura de arquivo, backup na nuvem, sincronização de pasta,
   * perfil copiado.
   */
  private guardarToken(token: string, email: string | null): void {
    this.token = token;
    // Sem isto, a primeira leitura preguiçosa aconteceria DEPOIS desta escrita
    // e devolveria o que estava no disco por cima do token que acabou de ser
    // emitido — trocando a sessão nova pela antiga logo após a ativação.
    this.tokenLido = true;
    // O e-mail é do PRÓPRIO vendedor, e serve só para o painel dizer em qual
    // conta ele está; vai em texto puro porque não é credencial de nada.
    if (email) this.disco.set('email', email);

    if (!safeStorage.isEncryptionAvailable()) {
      // Linux sem keyring é o caso real disso. Preferimos exigir novo
      // pareamento a cada abertura a gravar o JWT em texto puro — o atrito é do
      // vendedor, o vazamento seria da conta dele.
      return;
    }
    this.disco.set(
      'tokenCifrado',
      safeStorage.encryptString(token).toString('base64'),
    );
  }

  private lerToken(): string | null {
    const cifrado = this.disco.get('tokenCifrado');
    if (!cifrado || !safeStorage.isEncryptionAvailable()) return null;

    try {
      return safeStorage.decryptString(Buffer.from(cifrado, 'base64'));
    } catch {
      // Cifra de outro usuário ou de outra máquina: o certo é esquecer e
      // parear de novo, nunca insistir com um valor que não abre.
      this.disco.delete('tokenCifrado');
      return null;
    }
  }

  desconectar(): void {
    this.token = null;
    // Sair é definitivo nesta execução: sem a marca, a próxima chamada leria o
    // disco de novo e ressuscitaria a sessão que o vendedor acabou de encerrar
    // (a escrita do `delete` abaixo é o que impede, mas depender da ordem de
    // duas operações para não voltar a logar alguém é frágil demais).
    this.tokenLido = true;
    this.disco.delete('tokenCifrado');
    this.disco.delete('email');
  }

  // -------------------------------------------------------------------- run
  async abrirRun(entrada: {
    knowledgeSessionId: string;
    tiktokUsername?: string;
    tiktokRoomId?: string;
  }): Promise<LiveRunResumo> {
    const run = await this.requisitar<LiveRunResumo>(
      'POST',
      '/live/runs',
      entrada,
    );
    this.runId = run.id;
    return run;
  }

  /** Um lote do chat. O backend responde 202 e devolve as respostas pelo SSE. */
  async enviarLote(mensagens: ChatMessagePayload[]): Promise<void> {
    if (!this.runId || mensagens.length === 0) return;
    await this.requisitar('POST', `/live/runs/${this.runId}/messages`, {
      messages: mensagens,
    });
  }

  /**
   * Um lote de instantâneos de audiência (viewers, curtidas, presentes).
   * Deltas por janela de ~30s — quem agrega é o `AgregadorDeMetricas`.
   */
  async enviarMetricas(pontos: unknown[]): Promise<void> {
    if (!this.runId || pontos.length === 0) return;
    await this.requisitar('POST', `/live/runs/${this.runId}/metrics`, {
      metrics: pontos,
    });
  }

  /**
   * O batimento de um minuto — que é TAMBÉM a cobrança do minuto de live (ver o
   * comentário longo em `live-run.controller.ts`). Por isso ele começa junto
   * com a run e para junto: um timer que sobrevive ao fim da transmissão cobra
   * minuto de live que não existe mais.
   */
  iniciarHeartbeat(aoFalhar: (e: Error) => void): void {
    this.pararHeartbeat();
    this.heartbeat = setInterval(() => {
      const id = this.runId;
      if (!id) return;
      this.requisitar('POST', `/live/runs/${id}/heartbeat`, {}).catch(
        (erro: unknown) => aoFalhar(this.comoErro(erro)),
      );
    }, INTERVALO_HEARTBEAT_MS);
  }

  pararHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  async encerrarRun(
    motivo?: string,
    endReason?: 'manual' | 'aviso_tiktok',
  ): Promise<void> {
    const id = this.runId;
    this.pararHeartbeat();
    this.pararStream();
    this.runId = null;
    if (!id) return;

    await this.requisitar('POST', `/live/runs/${id}/end`, { motivo, endReason });
  }

  // ------------------------------------------------------- envio automático
  /** `GET /live/termo-envio-automatico`: o texto do aviso e o aceite da conta. */
  async obterTermoDeEnvio(): Promise<TermoDeEnvioResposta> {
    return this.requisitar<TermoDeEnvioResposta>(
      'GET',
      '/live/termo-envio-automatico',
    );
  }

  /**
   * `POST /live/aceitar-envio-automatico`.
   *
   * A versão viaja de volta exatamente como veio do termo exibido: o backend
   * recusa qualquer outra, e é essa recusa que garante que o aceite gravado se
   * refere ao texto que o vendedor teve na frente.
   */
  async aceitarEnvioAutomatico(versao: string): Promise<void> {
    await this.requisitar('POST', '/live/aceitar-envio-automatico', { versao });
  }

  /**
   * `GET /live/config/envio` — seletores, limites e kill switch.
   *
   * É a MESMA resposta que o `EnviadorDeComentarios` consome: a tela usa os
   * limites para dizer o que vai acontecer, o enviador usa tudo. Duas chamadas
   * com recortes diferentes deixariam a tela mostrando um cooldown e o envio
   * obedecendo a outro.
   */
  async obterConfigDeEnvio(): Promise<ConfigDeEnvio> {
    return this.requisitar<ConfigDeEnvio>('GET', '/live/config/envio');
  }

  /** `GET /live/runs/:id/queue` — o que já foi aprovado e ainda não saiu. */
  async filaDeEnvio(): Promise<RespostaNaFila[]> {
    const id = this.runId;
    if (!id) return [];
    return this.requisitar<RespostaNaFila[]>(
      'GET',
      `/live/runs/${id}/queue`,
    );
  }

  /**
   * `POST /live/replies/:id/delivery` — o desfecho de uma tentativa de envio.
   *
   * Idempotente no servidor, e é isso que permite repetir sem medo quando o ACK
   * não chega: `enviada` é estado final e a segunda confirmação não encontra
   * transição.
   */
  async confirmarEntrega(
    replyId: string,
    status: 'enviada' | 'falhou',
    failureReason?: string,
  ): Promise<void> {
    await this.requisitar('POST', `/live/replies/${replyId}/delivery`, {
      status,
      failureReason,
    });
  }

  /**
   * `POST /live/telemetry/selector-failure`.
   *
   * O HTML sobe já como esqueleto (ver `scriptDeEsqueleto`) e é saneado de novo
   * no servidor. O `runId` vai junto para dar de onde vem cada relato — é o que
   * permite ver se a mudança do TikTok pegou a frota ou uma conta só.
   */
  async reportarFalhaDeSeletor(
    html: string,
    version: number,
    contexto?: string,
  ): Promise<void> {
    await this.requisitar('POST', '/live/telemetry/selector-failure', {
      runId: this.runId ?? undefined,
      version,
      html,
      contexto,
    });
  }

  /**
   * `POST /live/runs/:id/events` — a trilha de auditoria da run: o app viu um
   * aviso do TikTok (e o que fez), ou tentou fixar um produto. Sem run aberta
   * vira no-op: evento de auditoria sem transmissão não tem onde morar.
   */
  async registrarEventoDaRun(
    tipo: 'aviso_tiktok' | 'pin_produto',
    acao?: string,
    detalhe?: string,
  ): Promise<void> {
    if (!this.runId) return;
    await this.requisitar('POST', `/live/runs/${this.runId}/events`, {
      tipo,
      acao,
      detalhe,
    });
  }

  /**
   * `POST /live/runs/:id/mode`.
   *
   * Não há caminho local para ligar o automático: a trava do aceite e o kill
   * switch moram no servidor, e é ele quem responde 403 quando o app pede um
   * modo que não pode ter. O erro sobe até a tela com o texto do backend.
   */
  async trocarModo(mode: LiveRunMode): Promise<{ mode: LiveRunMode }> {
    const id = this.runId;
    if (!id) throw new Error('Nenhuma transmissão em andamento.');
    return this.requisitar<{ mode: LiveRunMode }>(
      'POST',
      `/live/runs/${id}/mode`,
      { mode },
    );
  }

  /** O carimbo de "o vendedor usou esta resposta" — a métrica da fase. */
  async marcarCopiada(replyId: string): Promise<void> {
    await this.requisitar('POST', `/live/replies/${replyId}/copied`, {});
  }

  /**
   * Guarda a resposta na base de conhecimento, corrigida ou não.
   *
   * Diferente de `marcarCopiada`, esta chamada NÃO pode falhar em silêncio: o
   * vendedor acabou de digitar algo e espera que fique guardado. Se o erro for
   * engolido, ele descobre na live seguinte que a correção nunca existiu — e
   * aí já respondeu a mesma coisa à mão duas vezes.
   */
  async salvarNaBase(replyId: string, texto?: string): Promise<void> {
    await this.requisitar('POST', `/live/replies/${replyId}/save-to-base`, {
      ...(texto ? { text: texto } : {}),
    });
  }

  // -------------------------------------------------------------------- SSE
  /**
   * Consome `GET /live/runs/:id/stream`.
   *
   * Com `fetch` e não com `EventSource`: o `EventSource` não manda header
   * `Authorization`, e a rota é autenticada como todas as outras. A alternativa
   * seria token na query string — que vaza em log de proxy e em histórico —, e
   * por isso o backend já assume que quem consome este fluxo é um cliente de
   * verdade (ver o comentário "AUTENTICAÇÃO DO SSE" no controller).
   *
   * A reconexão é obrigatória e não um refinamento: o fluxo cai por qualquer
   * motivo banal (proxy que corta conexão ociosa, wi-fi oscilando) e o sintoma,
   * do lado do vendedor, é o painel simplesmente parar de responder no meio da
   * live, sem erro nenhum na tela.
   */
  iniciarStream(
    aoEvento: (evento: LiveEvent) => void,
    aoErro: (e: Error) => void,
  ): void {
    this.sseAtivo = true;
    void this.lacoDoStream(aoEvento, aoErro);
  }

  pararStream(): void {
    this.sseAtivo = false;
    this.sseAbort?.abort();
    this.sseAbort = null;
  }

  private async lacoDoStream(
    aoEvento: (evento: LiveEvent) => void,
    aoErro: (e: Error) => void,
  ): Promise<void> {
    let backoff = SSE_BACKOFF_INICIAL_MS;

    while (this.sseAtivo && this.runId) {
      const id = this.runId;
      try {
        const encerrou = await this.lerStream(id, aoEvento);
        // Reconectar depois de um `ended` seria reabrir um fluxo que o backend
        // já completou — o canal daquela run não existe mais.
        if (encerrou) return;
        backoff = SSE_BACKOFF_INICIAL_MS;
      } catch (erro) {
        if (!this.sseAtivo) return;
        aoErro(this.comoErro(erro));
      }

      if (!this.sseAtivo) return;
      await this.esperar(backoff);
      backoff = Math.min(backoff * 2, SSE_BACKOFF_MAXIMO_MS);
    }
  }

  /** @returns `true` se o fluxo terminou com `ended` (fim normal da run). */
  private async lerStream(
    runId: string,
    aoEvento: (evento: LiveEvent) => void,
  ): Promise<boolean> {
    const abort = new AbortController();
    this.sseAbort = abort;

    const resposta = await fetch(`${this.baseUrl}/live/runs/${runId}/stream`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${this.tokenAtual ?? ''}`,
      },
      signal: abort.signal,
    });

    if (!resposta.ok || !resposta.body) {
      throw new Error(`Fluxo da transmissão recusado (HTTP ${resposta.status}).`);
    }

    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    // O buffer atravessa as leituras porque um bloco do SSE quase nunca chega
    // alinhado com o chunk do TCP: cortar no que veio partiria o JSON no meio.
    let buffer = '';

    for (;;) {
      const { done, value } = await leitor.read();
      if (done) return false;

      buffer += decodificador.decode(value, { stream: true });

      let corte = buffer.indexOf('\n\n');
      while (corte !== -1) {
        const bloco = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);

        const evento = this.interpretarBloco(bloco);
        if (evento) {
          aoEvento(evento);
          if (evento.type === 'ended') return true;
        }
        corte = buffer.indexOf('\n\n');
      }
    }
  }

  /**
   * Traduz um bloco do SSE em evento.
   *
   * O Nest manda o tipo em `event:` e o payload em `data:`; o comentário de
   * keep-alive (linha começando com `:`) e qualquer campo desconhecido são
   * ignorados de propósito — o cliente tem que sobreviver a um campo novo que o
   * backend passe a mandar.
   */
  private interpretarBloco(bloco: string): LiveEvent | null {
    let tipo = '';
    let dados = '';

    for (const linha of bloco.split('\n')) {
      if (linha.startsWith('event:')) tipo = linha.slice(6).trim();
      else if (linha.startsWith('data:')) dados += linha.slice(5).trim();
    }
    if (!tipo || !dados) return null;

    try {
      return { type: tipo, data: JSON.parse(dados) } as LiveEvent;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ apoio
  private async requisitar<T>(
    metodo: 'GET' | 'POST',
    caminho: string,
    corpo?: unknown,
    opcoes: { autenticado?: boolean } = {},
  ): Promise<T> {
    const autenticado = opcoes.autenticado !== false;
    if (autenticado && !this.tokenAtual) {
      throw new Error('Dispositivo não pareado.');
    }

    let resposta: Response;
    try {
      resposta = await fetch(`${this.baseUrl}${caminho}`, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          ...(autenticado ? { Authorization: `Bearer ${this.tokenAtual}` } : {}),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch (erro) {
      /*
       * A rede falhando não é um status HTTP, e por isso escapava de todo o
       * cuidado que existe logo abaixo: `fetch` REJEITA quando o DNS não
       * resolve, a máquina está offline ou o servidor recusa a conexão. Sem
       * este catch, o que chegava à tela era `TypeError: fetch failed` — e,
       * atravessando o IPC, com o prefixo `Error invoking remote method
       * 'ativacao:iniciar'`. Nenhuma das duas metades dessa frase é sobre o
       * problema do vendedor, e nenhuma diz o que fazer.
       *
       * O endereço vai junto na mensagem de propósito. Foi exatamente assim
       * que um instalador antigo, apontando para um domínio que nunca foi
       * registrado, ficou dias parecendo "app quebrado": a tela dizia
       * "não consegui gerar o código" e não havia como saber, olhando para
       * ela, que o app estava batendo num endereço morto.
       */
      throw new Error(
        `Não consegui falar com o servidor do PikPok (${this.baseUrl}). ` +
          'Confira sua conexão com a internet; se ela estiver boa, o app pode ' +
          'estar desatualizado — baixe a versão mais recente.',
        { cause: erro },
      );
    }

    if (resposta.status === 401 && autenticado) {
      // O token de 30 dias venceu ou foi revogado na web. Esquecer aqui é o que
      // faz o painel cair na tela de pareamento em vez de repetir 401 calado.
      this.desconectar();
      throw new Error('Sessão expirada. Pareie o dispositivo de novo.');
    }

    if (!resposta.ok) {
      throw new Error(await this.mensagemDeErro(resposta));
    }

    // 202 e 204 podem vir sem corpo; `json()` nesse caso estoura.
    const texto = await resposta.text();
    return (texto ? JSON.parse(texto) : {}) as T;
  }

  /**
   * O backend responde erro em português e já pensado para o usuário final
   * ("Você não tem minutos de live suficientes"), então a mensagem dele vale
   * mais que qualquer texto genérico que fosse escrito aqui.
   *
   * MAS ISSO SÓ VALE PARA AS EXCEÇÕES QUE NÓS ESCREVEMOS. As do framework
   * escapam com o nome da classe dentro do `message`, e o vendedor recebia na
   * tela, em inglês, "ThrottlerException: Too Many Requests" — que não diz o
   * que aconteceu nem o que fazer. Os status abaixo têm texto próprio; o resto
   * segue confiando no backend.
   */
  private async mensagemDeErro(resposta: Response): Promise<string> {
    if (resposta.status === 429) {
      return 'Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.';
    }
    if (resposta.status >= 500) {
      return 'O PikPok não respondeu agora. Tente de novo em alguns segundos.';
    }

    try {
      const corpo = (await resposta.json()) as { message?: string | string[] };
      const mensagem = Array.isArray(corpo.message)
        ? corpo.message.join('; ')
        : corpo.message;
      // Uma mensagem com "Exception" no meio é vazamento de framework, não
      // texto de produto: não vai para a tela de ninguém.
      if (mensagem && !/exception/i.test(mensagem)) return mensagem;
    } catch {
      // Corpo vazio ou não-JSON: cai no genérico abaixo.
    }
    return `Falha na chamada ao PikPok (HTTP ${resposta.status}).`;
  }

  private esperar(ms: number): Promise<void> {
    return new Promise((resolver) => setTimeout(resolver, ms));
  }

  private comoErro(erro: unknown): Error {
    return erro instanceof Error ? erro : new Error(String(erro));
  }
}
