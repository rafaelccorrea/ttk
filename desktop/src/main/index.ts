import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BrowserView,
  BrowserWindow,
  app,
  globalShortcut,
  ipcMain,
  nativeTheme,
  session,
  shell,
} from 'electron';
import type { ConfiguracoesCopiloto } from '../shared/desktop-api';
import type { LiveRunMode } from '../shared/live-events';
import { Copiloto } from './copiloto';
import { ModoFoco } from './foco';
import { estadoDaAtualizacao, iniciarAtualizador, instalarAgora } from './atualizador';

/**
 * Processo principal do copiloto ao vivo, em MODO SOMENTE-PAINEL.
 *
 * A janela é dividida em dois mundos que NÃO se conhecem:
 *
 *   [ 60% BrowserView ]  [ 40% renderer ]
 *    tiktok.com, o site   o painel do PikPok
 *    de terceiro           (React + MUI)
 *
 * Nesta fase nada é escrito no TikTok: a BrowserView existe para o vendedor
 * ficar logado e enxergar a própria live no mesmo app, enquanto as respostas
 * aparecem ao lado para ele copiar ou falar em voz alta. A leitura do chat e a
 * ponte com o backend entram depois; aqui é só a casca.
 */

/** Fatia da largura da janela que fica com o TikTok. */
const FRACAO_TIKTOK = 0.6;

/**
 * O ícone do app — a mesma arte que o site usa como favicon.
 *
 * Ele resolve DOIS lugares que não são a janela: a barra de tarefas do Windows
 * e o Alt+Tab. Sem isto o Electron mostra o seu próprio átomo cinza, e um app
 * que o vendedor deixa aberto a live inteira aparece na barra dele como se
 * fosse outro programa qualquer.
 *
 * Empacotado o arquivo vai para `resources/`; em desenvolvimento ele é lido do
 * repositório. `app.isPackaged` separa os dois — `__dirname` aponta para
 * `out/main` nos dois casos e sozinho não distingue nada.
 */
const CAMINHO_ICONE = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../resources/icon.png');

/**
 * A mesma logo, como data URL, para a tela de espera do modo foco — que é um
 * data URL inteiro e não enxerga `file://`. Falhar aqui não quebra nada: a
 * espera tem um tile com a inicial como fallback.
 */
function logoParaEspera(): string | null {
  try {
    return `data:image/png;base64,${readFileSync(CAMINHO_ICONE).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Identidade do app para o Windows.
 *
 * Sem um AppUserModelID próprio, o Windows agrupa a janela sob o ID genérico
 * do Electron: o ícone da barra de tarefas volta a ser o átomo, fixar o app na
 * barra fixa o Electron em vez do PikPok, e notificações saem sem remetente.
 * Precisa ser o mesmo `appId` do electron-builder, senão a versão instalada e
 * a janela em execução viram duas entradas separadas na barra.
 */
if (process.platform === 'win32') app.setAppUserModelId('com.pikpok.desktop');

/**
 * A BARRA DE TÍTULO também é o app.
 *
 * Sem isto o Windows desenha a barra na cor de acento do usuário — verde, azul,
 * o que ele tiver escolhido — em cima de uma janela que é preta do TikTok à
 * esquerda e preta do painel à direita. `themeSource = 'dark'` liga o modo
 * escuro imersivo do Windows e a barra passa a acompanhar a janela, junto com
 * os menus de contexto e a barra de rolagem nativa.
 *
 * É forçado em vez de seguir o sistema porque o app NÃO tem tema claro: quem
 * usa o Windows no claro receberia uma barra branca colada num painel preto.
 */
nativeTheme.themeSource = 'dark';

const LARGURA_INICIAL = 1440;
const ALTURA_INICIAL = 900;

/**
 * A altura da barra de título própria.
 *
 * `themeSource = 'dark'` acima escurece menus e barra de rolagem, mas NÃO manda
 * na moldura: quem tem "mostrar cor de destaque na barra de título" ligado no
 * Windows recebe a barra pintada de verde, roxo, o que ele tiver escolhido, em
 * cima de uma janela preta do TikTok à esquerda e preta do painel à direita. Não
 * há API para colorir o frame nativo — a única saída é não usar frame: com
 * `titleBarStyle: 'hidden'` os botões de minimizar/maximizar/fechar viram um
 * overlay que NÓS pintamos, e continuam sendo os nativos do sistema.
 *
 * O preço é esta faixa: o conteúdo passa a começar no topo absoluto da janela, e
 * estes 32px precisam ser descontados de tudo que se posiciona — a BrowserView
 * aqui embaixo e o painel no renderer, que desenha a faixa de arrastar.
 */
const ALTURA_BARRA = 32;

/**
 * A partição da sessão do TikTok.
 *
 * O prefixo `persist:` é o que grava cookies e localStorage em disco. Sem ele o
 * vendedor faria login (com 2FA, provavelmente) a CADA abertura do app — e
 * ninguém abre um copiloto de live com esse atrito minutos antes de entrar no
 * ar. A partição também é NOMEADA e separada da sessão padrão de propósito: o
 * que o tiktok.com guardar fica confinado nela, sem encostar na sessão onde o
 * painel do PikPok mantém o token do próprio usuário.
 */
const PARTICAO_TIKTOK = 'persist:tiktok';

const URL_TIKTOK_LIVE = 'https://www.tiktok.com/live';

function criarJanela(): BrowserWindow {
  const janela = new BrowserWindow({
    width: LARGURA_INICIAL,
    height: ALTURA_INICIAL,
    minWidth: 1100,
    minHeight: 700,
    title: 'PikPok Copiloto',
    icon: CAMINHO_ICONE,
    /*
     * O menu "File / Edit / View / Window / Help" padrão do Electron some da
     * tela, mas NÃO é removido: ele volta com o Alt e, principalmente, é ele
     * que registra os aceleradores de recortar/copiar/colar. Um
     * `Menu.setApplicationMenu(null)` mataria o Ctrl+C — o gesto central deste
     * produto, que é copiar a resposta e colar no chat.
     */
    autoHideMenuBar: true,
    // A moldura sai, os botões do Windows ficam — pintados com o preto do app.
    // Ver ALTURA_BARRA.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0c10',
      symbolColor: '#e6e8ee',
      height: ALTURA_BARRA,
    },
    // Só aparece quando o conteúdo já pintou: abrir a janela em branco e
    // preenchê-la depois lê como travamento.
    show: false,
    // O mesmo preto do fundo do painel: é ele que fica no lugar do conteúdo
    // enquanto a janela pinta e enquanto o usuário redimensiona. Um flash
    // branco antes de um app escuro é o detalhe que denuncia o Electron.
    backgroundColor: '#0b0c10',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // NÃO NEGOCIÁVEL — ver o comentário longo em src/preload/index.ts.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  janela.once('ready-to-show', () => janela.show());

  // Qualquer `target=_blank` do painel vai para o navegador do sistema. Deixar
  // o Electron abrir janelas próprias criaria telas sem preload e sem as
  // travas acima — janelas que ninguém configurou.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void janela.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void janela.loadFile(join(__dirname, '../renderer/index.html'));
  }

  anexarTikTok(janela);
  return janela;
}

/**
 * Encaixa o TikTok na metade esquerda da janela.
 *
 * SEGURANÇA — LEIA ANTES DE MEXER
 * -------------------------------
 * Esta view carrega um site de TERCEIRO, que roda o JavaScript dele dentro do
 * nosso processo de renderização. Ela e o renderer do painel são mundos
 * separados, e precisam continuar sendo:
 *
 *  - a BrowserView NÃO recebe o preload do app. Quando a fase 2 lhe der um
 *    preload próprio (para ler o DOM do chat), esse preload expõe APENAS o que
 *    a leitura do chat exige, e NUNCA a API do painel. Um `contextBridge` com
 *    "só uma chamadinha" para o backend, exposto aqui, é uma página do
 *    tiktok.com — ou qualquer script injetado nela — falando com a nossa API
 *    autenticada;
 *  - `nodeIntegration` fica desligado e `contextIsolation` ligado também aqui,
 *    pelos mesmos motivos, e com muito mais razão: aqui o código não é nosso;
 *  - a comunicação entre os dois mundos passa pelo processo principal, que é
 *    onde dá para conferir origem e formato do que trafega.
 */
/**
 * A view viva do TikTok.
 *
 * É uma variável de módulo (lida por FUNÇÃO, nunca guardada como referência lá
 * embaixo) porque a janela morre e renasce: quem precisa do `webContents` para
 * digitar no chat tem que enxergar a view ATUAL, e não a que existia quando o
 * copiloto foi construído.
 */
let viewTikTok: BrowserView | null = null;

function anexarTikTok(janela: BrowserWindow): void {
  const view = new BrowserView({
    webPreferences: {
      partition: PARTICAO_TIKTOK,
      contextIsolation: true,
      nodeIntegration: false,
      // Sem `preload` de propósito: nesta fase o site não precisa de nenhuma
      // ponte, e a ausência é a configuração segura por padrão.
    },
  });

  viewTikTok = view;
  janela.setBrowserView(view);
  void view.webContents.loadURL(URL_TIKTOK_LIVE);
  // A view nasce presa ao modo foco: trava de navegação + tela por estado.
  foco.anexar(view.webContents);

  const posicionar = (): void => {
    const { width, height } = janela.getContentBounds();
    // O `y` desce a altura da barra própria: sem frame, a origem da janela é o
    // topo absoluto, e uma view em `y: 0` passaria por baixo dos botões de
    // fechar e maximizar.
    view.setBounds({
      x: 0,
      y: ALTURA_BARRA,
      width: Math.round(width * FRACAO_TIKTOK),
      height: Math.max(0, height - ALTURA_BARRA),
    });
  };

  posicionar();
  // `setAutoResize` do Electron reescala proporcionalmente e desalinha a
  // divisão quando a janela muda de forma; recalcular na mão mantém os 60/40
  // exatos em qualquer tamanho.
  janela.on('resize', posicionar);
  /*
   * E uma vez mais quando a janela vai à tela.
   *
   * A janela é PEDIDA com 1440x900, mas o Windows a entrega menor quando não
   * cabe (monitor menor, escala em 125%, barra de tarefas) — aqui, 1426x779.
   * Esse ajuste acontece depois do `posicionar()` de cima, e se ele não
   * emitisse `resize` a view ficaria com a largura do tamanho pedido enquanto o
   * painel se posiciona pelos 60% do tamanho real, com o TikTok invadindo a
   * faixa do painel.
   *
   * Medido nesta máquina, o `resize` FOI emitido e os dois valores batem — ou
   * seja, isto não corrige um defeito observado. Fica como uma linha de seguro
   * barata contra a ordem inversa, que depende do gerenciador de janelas e não
   * de nós; se algum dia sobrar, é uma chamada idempotente a mais.
   */
  janela.once('ready-to-show', posicionar);
}

/**
 * Apaga o login do TikTok junto com o do PikPok.
 *
 * Sair da conta e continuar logado no TikTok é o pior desfecho possível no
 * cenário que este produto assume: o COMPUTADOR DA LOJA, onde o próximo
 * vendedor senta e ativa o aparelho com a conta dele. Se a partição sobrevive,
 * a pessoa que sai deixa a própria conta do TikTok — cookies de sessão, e a
 * capacidade de postar no chat em nome dela — na mão de quem chegar. O botão
 * diz "sair e trocar de conta"; ele precisa entregar as DUAS.
 *
 * Limpa TUDO (`storages` omitido = todos) e não só cookies: o tiktok.com guarda
 * identificadores de sessão também em localStorage e IndexedDB, e apagar meia
 * sessão devolveria uma tela logada pela metade — pior que nenhuma limpeza,
 * porque parece resolvida.
 *
 * O reload no fim é o que o vendedor VÊ: sem ele a view continuaria pintando a
 * página logada em memória, e a única prova de que o logout funcionou só
 * apareceria na próxima abertura do app.
 */
/**
 * Se há alguém logado no TikTok dentro do app.
 *
 * A pergunta é respondida pelo COOKIE `sessionid` da partição, e não pelo DOM da
 * página: ler a tela do tiktok.com significaria depender do layout dele, que
 * muda sem avisar, e é exatamente esse acoplamento que já obrigou o app a ter um
 * relatório de falha de seletor. O cookie é o mesmo dado que o site usa para
 * decidir se você está logado, e some sozinho quando a sessão expira.
 *
 * Vale para os dois passos de onboarding e para o botão de conectar: sem esta
 * sessão o copiloto não lê o chat nem digita nele, então prometer uma live
 * seria vender o que não dá para entregar.
 */
async function tiktokLogado(): Promise<boolean> {
  const cookies = await session
    .fromPartition(PARTICAO_TIKTOK)
    .cookies.get({ domain: '.tiktok.com', name: 'sessionid' })
    .catch(() => []);
  return cookies.some((c) => c.value.length > 0);
}

/**
 * Quantos seguidores a conta tem, ou `null` quando não der para saber.
 *
 * POR QUE ISTO É UMA INDICAÇÃO, E NUNCA UM VEREDITO
 * -------------------------------------------------
 * O TikTok não publica API de elegibilidade para live. A regra conhecida é o
 * piso de mil seguidores, mas idade, região e restrições de conta também pesam
 * e nenhuma delas é consultável. Então isto responde "provavelmente falta
 * seguidor", e não "esta conta não pode transmitir" — quem tem mil e está
 * restrito passaria por aqui igual.
 *
 * Por isso a leitura NÃO trava nada. Ela existe para o vendedor descobrir o
 * motivo mais comum antes de comprar minutos, e é lida da página pública do
 * perfil pela sessão do próprio app: o cookie vai junto, então o TikTok
 * responde o mesmo que responderia ao navegador dele.
 *
 * Qualquer tropeço — rede, captcha, HTML remontado — devolve `null` e a tela
 * simplesmente não fala do assunto. Um palpite errado aqui assustaria alguém
 * que pode transmitir, o que é pior do que não dizer nada.
 */
async function seguidoresDe(usuario: string): Promise<number | null> {
  const limpo = usuario.trim().replace(/^@/, '');
  // O @ vai para dentro de uma URL: só o que é nome de usuário do TikTok passa,
  // e o resto nem sai daqui.
  if (!/^[A-Za-z0-9._]{2,24}$/.test(limpo)) return null;

  try {
    // `fetch` DA SESSÃO, e não o `net.fetch` global: é o que faz a requisição
    // sair com os cookies da partição do TikTok, como se fosse a aba do
    // vendedor. Pelo global, o perfil viria como o de um visitante anônimo.
    const resposta = await session
      .fromPartition(PARTICAO_TIKTOK)
      .fetch(`https://www.tiktok.com/@${limpo}`, { credentials: 'include' });
    if (!resposta.ok) return null;
    const html = await resposta.text();
    /*
     * O número vem do JSON que o TikTok embute na página para hidratar o app
     * dele. É frágil por natureza — é dado de terceiro, num formato que ninguém
     * nos prometeu — e é exatamente por isso que a falha aqui é `null` em vez de
     * erro: a tela some com o aviso, e o vendedor continua o fluxo.
     */
    const m = /"followerCount":\s*(\d+)/.exec(html);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * O @ da conta logada na view do TikTok, ou `null` quando não der para saber.
 *
 * Existe para a tela de conectar não pedir o que o app já sabe: na enorme
 * maioria das lives, quem transmite é a MESMA conta logada na metade esquerda
 * da janela — e o vendedor digitava o próprio @ de novo, com direito a erro de
 * digitação que conectava o copiloto na live de um estranho.
 *
 * O nome sai do JSON de hidratação da home do tiktok.com, lido com a sessão da
 * partição — o mesmo caminho (e a mesma fragilidade assumida) de
 * `seguidoresDe`: dado de terceiro, sem contrato, então qualquer tropeço vira
 * `null` e a tela apenas volta a pedir o @ digitado. É indicação com conserto
 * visível — o campo continua editável para o caso raro de transmitir por outra
 * conta.
 */
async function usuarioDoTikTok(): Promise<string | null> {
  if (!(await tiktokLogado())) return null;
  try {
    const resposta = await session
      .fromPartition(PARTICAO_TIKTOK)
      // `credentials: 'include'` é obrigatório: este fetch parte do processo
      // principal, sem origem, e sem a diretiva os cookies da partição ficam
      // de fora — a home viria DESLOGADA e o @ nunca apareceria.
      .fetch('https://www.tiktok.com/foryou', { credentials: 'include' });
    if (!resposta.ok) {
      console.warn(`[usuarioDoTikTok] resposta ${resposta.status} da home`);
      return null;
    }
    const html = await resposta.text();

    /*
     * Caminho principal: o JSON inteiro que o TikTok embute para hidratar o
     * app dele, parseado de verdade. O usuário LOGADO mora em
     * `__DEFAULT_SCOPE__["webapp.app-context"].user` — os `uniqueId` soltos
     * pela página são autores de vídeo do feed, e é por isso que a leitura
     * ancora nesse objeto e nunca no primeiro match do HTML.
     */
    const bloco =
      /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(
        html,
      );
    if (bloco) {
      try {
        const dados = JSON.parse(bloco[1]!) as {
          __DEFAULT_SCOPE__?: Record<string, { user?: { uniqueId?: string } }>;
        };
        const unico = dados.__DEFAULT_SCOPE__?.['webapp.app-context']?.user?.uniqueId;
        if (unico && /^[A-Za-z0-9._]{2,24}$/.test(unico)) return unico;
      } catch (erro) {
        console.warn(`[usuarioDoTikTok] JSON de hidratação ilegível: ${erro}`);
      }
    } else {
      console.warn('[usuarioDoTikTok] página veio sem __UNIVERSAL_DATA_FOR_REHYDRATION__');
    }

    // Fallback: o mesmo dado, caçado por regex — vale quando o TikTok mudar o
    // id do script ou embutir o contexto de outro jeito.
    const m = /"user"\s*:\s*\{[^{}]*?"uniqueId"\s*:\s*"([A-Za-z0-9._]{2,24})"/.exec(html);
    if (!m) console.warn('[usuarioDoTikTok] nenhum uniqueId de usuário logado no HTML');
    return m ? m[1]! : null;
  } catch (erro) {
    console.warn(`[usuarioDoTikTok] falhou: ${erro}`);
    return null;
  }
}

/**
 * Avisa o painel quando esse login entra ou sai.
 *
 * Sem isto, quem terminasse o login à esquerda ficaria olhando para um passo 1
 * que continua pedindo login — o painel não tem como enxergar dentro da
 * BrowserView, e ninguém deveria precisar reabrir o app para a tela perceber.
 * O evento `changed` da sessão cobre login, logout e expiração pelo mesmo
 * caminho.
 */
function observarLoginDoTikTok(): void {
  const particao = session.fromPartition(PARTICAO_TIKTOK);
  particao.cookies.on('changed', (_evento, cookie) => {
    if (cookie.name !== 'sessionid') return;
    void tiktokLogado().then((logado) => {
      foco.definirLogado(logado);
      const janela = janelaPrincipal;
      if (janela && !janela.isDestroyed()) {
        janela.webContents.send('tiktok:logado', logado);
      }
    });
  });
}

async function limparSessaoTikTok(): Promise<void> {
  const particao = session.fromPartition(PARTICAO_TIKTOK);
  await particao.clearStorageData();
  await particao.clearCache();
  // `clearStorageData` não emite o evento de cookie: avisa o foco à mão, senão
  // a view continuaria no último estado até a próxima abertura.
  foco.definirLogado(false);

  const view = viewTikTok;
  if (view && !view.webContents.isDestroyed()) {
    await view.webContents.loadURL(URL_TIKTOK_LIVE).catch(() => undefined);
  }
}

/**
 * A janela do painel, para o copiloto ter para onde publicar os eventos.
 *
 * É uma função e não a referência direta porque a janela morre e renasce (o
 * `activate` do macOS recria), e um `BrowserWindow` guardado numa variável
 * viraria um objeto destruído para o qual o `webContents.send` estoura.
 */
let janelaPrincipal: BrowserWindow | null = null;

/**
 * O modo foco da view do TikTok — ver `foco.ts`. Vive aqui porque é o processo
 * principal quem conhece as três fontes que decidem o que a esquerda mostra:
 * o cookie de login, o estado da run e a sessão para espiar a página da live.
 */
const foco = new ModoFoco({
  view: () => {
    const view = viewTikTok;
    if (!view || view.webContents.isDestroyed()) return null;
    return view.webContents;
  },
  urlLogin: URL_TIKTOK_LIVE,
  estaLogado: () => tiktokLogado(),
  usuarioLogado: () => usuarioDoTikTok(),
  buscar: async (url) => {
    try {
      const resposta = await session
        .fromPartition(PARTICAO_TIKTOK)
        .fetch(url, { credentials: 'include' });
      return resposta.ok ? await resposta.text() : null;
    } catch {
      return null;
    }
  },
  logo: logoParaEspera(),
});

const copiloto = new Copiloto(
  () => janelaPrincipal,
  () => {
    const view = viewTikTok;
    if (!view || view.webContents.isDestroyed()) return null;
    return view.webContents;
  },
  (estado) => foco.definirConexao(estado),
);

/**
 * Registra os handlers do IPC.
 *
 * Cada `handle` aqui é uma porta que o conteúdo do renderer atravessa, e por
 * isso a lista é EXATAMENTE a `PikPokDesktopApi` do preload — nada de canal
 * genérico, nada de handler "só para depurar". Os erros sobem para o painel
 * como rejeição do `invoke`, com a mensagem em português que o backend já
 * escreveu; traduzir de novo aqui só produziria dois textos para o mesmo
 * problema.
 */
function registrarIpc(): void {
  ipcMain.handle('app:versao', () => app.getVersion());
  ipcMain.handle('app:abrirNoNavegador', (_evento, url: string) => {
    // Só http(s) sai daqui: um `file://` ou um esquema de app registrado no SO,
    // vindo do renderer, seria execução de coisa arbitrária na máquina do
    // vendedor a partir de conteúdo de página.
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  ipcMain.handle('tiktok:logado', () => tiktokLogado());
  ipcMain.handle('tiktok:seguidores', (_evento, usuario: string) =>
    seguidoresDe(usuario),
  );
  ipcMain.handle('tiktok:usuario', () => usuarioDoTikTok());
  ipcMain.handle('ativacao:iniciar', () => copiloto.iniciarAtivacao());
  ipcMain.handle('sessao:obter', () => copiloto.obterSessao());
  // A ordem importa: o copiloto encerra a run com o token ainda válido, e só
  // depois a partição do TikTok cai. Limpar o TikTok primeiro não quebraria o
  // encerramento, mas deixaria a view recarregando no meio da despedida.
  ipcMain.handle('sessao:sair', async () => {
    await copiloto.sair();
    await limparSessaoTikTok();
  });

  ipcMain.handle('atualizacao:obter', () => estadoDaAtualizacao());
  ipcMain.handle('atualizacao:instalar', () => instalarAgora());

  ipcMain.handle('live:bases', () => copiloto.listarBases());
  ipcMain.handle('live:carteira', () => copiloto.obterCarteiraLive());
  ipcMain.handle(
    'live:conectar',
    (_evento, params: { knowledgeSessionId: string; tiktokUsername: string }) =>
      copiloto.conectar(params),
  );
  ipcMain.handle('live:encerrar', (_evento, motivo?: string) =>
    copiloto.encerrar(motivo),
  );
  ipcMain.handle('live:pausar', (_evento, pausado: boolean) =>
    copiloto.pausar(pausado),
  );
  ipcMain.handle('live:conexao', () => copiloto.obterConexao());

  ipcMain.handle(
    'live:copiarResposta',
    (_evento, dados: { replyId: string; texto: string }) =>
      copiloto.copiarResposta(dados.replyId, dados.texto),
  );
  ipcMain.handle('live:copiarTexto', (_evento, texto: string) =>
    copiloto.copiarTexto(texto),
  );
  ipcMain.handle(
    'live:salvarNaBase',
    (_evento, dados: { replyId: string; texto?: string }) =>
      copiloto.salvarNaBase(dados.replyId, dados.texto),
  );
  ipcMain.handle(
    'live:resolverEscalacao',
    (
      _evento,
      dados: { chatMessageId: string; desfecho: 'respondida' | 'descartada' },
    ) => copiloto.resolverEscalacao(dados.chatMessageId, dados.desfecho),
  );

  ipcMain.handle('envio:estado', () => copiloto.obterEstadoEnvio());
  ipcMain.handle('envio:termo', () => copiloto.obterTermoDeEnvio());
  ipcMain.handle('envio:aceitar', (_evento, versao: string) =>
    copiloto.aceitarTermoDeEnvio(versao),
  );
  ipcMain.handle('envio:modo', (_evento, modo: LiveRunMode) =>
    // O renderer é conteúdo: um valor fora dos dois modos vira `painel`, que é o
    // lado seguro do erro.
    copiloto.definirModoDeEnvio(modo === 'auto' ? 'auto' : 'painel'),
  );
  ipcMain.handle('envio:pausar', (_evento, pausado: boolean) =>
    copiloto.pausarEnvio(Boolean(pausado)),
  );

  ipcMain.handle('config:ler', () => copiloto.lerConfiguracoes());
  ipcMain.handle('config:salvar', (_evento, valores: ConfiguracoesCopiloto) =>
    copiloto.salvarConfiguracoes(valores),
  );
}

/**
 * O freio de mão do envio automático.
 *
 * GLOBAL, e não um atalho da janela: quem está vendendo ao vivo está com o foco
 * no TikTok — apresentando o produto, lendo o chat, mexendo na câmera — e não no
 * nosso painel. Um atalho que só funciona com a nossa janela em primeiro plano
 * exigiria achar e clicar na janela antes de parar o app de escrever, o que é
 * pedir dois gestos justamente no segundo em que o vendedor viu uma bobagem
 * saindo em nome dele. O botão da barra continua existindo para quem já está
 * olhando para cá; este atalho é para quem não está.
 */
const ATALHO_PAUSA = 'CommandOrControl+Shift+P';

function registrarAtalhoDePausa(): void {
  const registrou = globalShortcut.register(ATALHO_PAUSA, () => {
    const estado = copiloto.obterEstadoEnvio();
    copiloto.pausarEnvio(!estado.pausado);
  });

  if (!registrou) {
    // Outro app já tomou a combinação. Não há o que fazer no sistema, e não é
    // fatal — mas a tela precisa saber para não prometer um atalho que não
    // existe, então o painel confere isto ao montar a barra.
    console.warn(
      `Não foi possível registrar ${ATALHO_PAUSA}: outro programa já usa esse atalho.`,
    );
  }
}

/**
 * UMA JANELA POR MÁQUINA, E ISSO NÃO É PREFERÊNCIA DE INTERFACE.
 *
 * Duas instâncias deste app não são duas telas do mesmo programa — são dois
 * copilotos completos, e cada um deles:
 *
 *  · abre a própria run e manda o próprio heartbeat, e o heartbeat é o que
 *    DEBITA MINUTO da carteira. Duas instâncias esquecidas abertas consomem o
 *    saldo em dobro, e o vendedor descobre pelo saldo zerado no meio da live;
 *  · lê o mesmo chat e responde as mesmas perguntas — no modo automático, isso
 *    é a mesma resposta postada duas vezes no chat de quem está assistindo,
 *    que é exatamente o padrão que faz o TikTok tratar a conta como robô;
 *  · escreve no mesmo `pikpok.json`. A última escrita ganha, e sair numa das
 *    janelas apaga o token da outra.
 *
 * `requestSingleInstanceLock` devolve `false` para a SEGUNDA instância, que
 * encerra na hora — antes do `whenReady`, portanto antes de existir janela,
 * updater ou qualquer chamada ao backend. A primeira recebe `second-instance` e
 * traz para a frente a janela que já existe, que é o que a pessoa queria ao
 * clicar no ícone de novo.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  const janela = janelaPrincipal;
  if (!janela || janela.isDestroyed()) return;
  // Minimizada, restaura; atrás de outra janela, sobe. Sem o `restore` o
  // `focus` numa janela minimizada não faz nada visível no Windows, e o clique
  // no ícone pareceria ter sido ignorado.
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
});

void app.whenReady().then(() => {
  // A segunda instância já chamou `app.quit()` acima, mas o `whenReady` dela
  // ainda resolveria e criaria a janela antes de o encerramento concluir.
  if (!app.hasSingleInstanceLock()) return;

  registrarIpc();
  registrarAtalhoDePausa();
  observarLoginDoTikTok();

  janelaPrincipal = criarJanela();

  // A janela vai por função: o `activate` do macOS abaixo pode recriá-la, e uma
  // referência fixa deixaria o updater avisando uma janela já destruída.
  iniciarAtualizador(() => janelaPrincipal);

  // No macOS o app segue vivo sem janela; clicar no dock reabre.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      janelaPrincipal = criarJanela();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Fechar o app encerra a run.
 *
 * Sem isto, a transmissão ficaria aberta no backend depois de o vendedor fechar
 * a janela. O heartbeat para junto — então a cobrança para sozinha, que é o
 * desenho descrito no controller —, mas a run continuaria com status 'ativa' e
 * a próxima tentativa de conectar esbarraria numa live fantasma.
 */
app.on('before-quit', () => {
  void copiloto.encerrar('O aplicativo foi fechado.');
});

// Atalho global que sobrevive ao app seria uma tecla sequestrada do sistema.
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
