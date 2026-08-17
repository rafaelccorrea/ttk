import { join } from 'node:path';
import {
  BrowserView,
  BrowserWindow,
  app,
  globalShortcut,
  ipcMain,
  shell,
} from 'electron';
import type { ConfiguracoesCopiloto } from '../shared/desktop-api';
import type { LiveRunMode } from '../shared/live-events';
import { Copiloto } from './copiloto';

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

const LARGURA_INICIAL = 1440;
const ALTURA_INICIAL = 900;

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
    // Só aparece quando o conteúdo já pintou: abrir a janela em branco e
    // preenchê-la depois lê como travamento.
    show: false,
    backgroundColor: '#fafafa',
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

  const posicionar = (): void => {
    const { width, height } = janela.getContentBounds();
    view.setBounds({
      x: 0,
      y: 0,
      width: Math.round(width * FRACAO_TIKTOK),
      height,
    });
  };

  posicionar();
  // `setAutoResize` do Electron reescala proporcionalmente e desalinha a
  // divisão quando a janela muda de forma; recalcular na mão mantém os 60/40
  // exatos em qualquer tamanho.
  janela.on('resize', posicionar);
}

/**
 * A janela do painel, para o copiloto ter para onde publicar os eventos.
 *
 * É uma função e não a referência direta porque a janela morre e renasce (o
 * `activate` do macOS recria), e um `BrowserWindow` guardado numa variável
 * viraria um objeto destruído para o qual o `webContents.send` estoura.
 */
let janelaPrincipal: BrowserWindow | null = null;

const copiloto = new Copiloto(
  () => janelaPrincipal,
  () => {
    const view = viewTikTok;
    if (!view || view.webContents.isDestroyed()) return null;
    return view.webContents;
  },
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

  ipcMain.handle('ativacao:iniciar', () => copiloto.iniciarAtivacao());
  ipcMain.handle('sessao:obter', () => copiloto.obterSessao());
  ipcMain.handle('sessao:sair', () => copiloto.sair());

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

void app.whenReady().then(() => {
  registrarIpc();
  registrarAtalhoDePausa();

  janelaPrincipal = criarJanela();

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
