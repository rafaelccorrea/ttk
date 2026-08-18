import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { EstadoAtualizacao } from '../shared/desktop-api';

/**
 * A atualização automática do copiloto.
 *
 * A REGRA QUE MANDA AQUI: NADA REINICIA DURANTE UMA LIVE.
 * -------------------------------------------------------
 * Este app é usado com a câmera ligada e com clientes perguntando no chat. Um
 * updater que baixa e pede "reiniciar agora" no meio disso não é uma
 * inconveniência — ele derruba a run, para de responder o chat e faz o vendedor
 * perder venda ao vivo por causa de um bugfix. Por isso o fluxo é o mais
 * silencioso que o electron-updater permite:
 *
 *   1. baixa em segundo plano, sem perguntar nada;
 *   2. NÃO instala, NÃO reinicia, NÃO abre diálogo nativo;
 *   3. avisa o painel, que mostra uma linha discreta no rodapé;
 *   4. instala sozinho quando o vendedor fechar o app, no tempo dele.
 *
 * O passo 4 é o que fecha o ciclo sem nunca interromper: `autoInstallOnAppQuit`
 * aplica o pacote já baixado no encerramento, e na próxima abertura ele já está
 * na versão nova. Quem quiser antes tem o botão de reiniciar no painel — a
 * decisão é do vendedor, e ele sabe se está no ar; nós não sabemos com certeza
 * suficiente para decidir por ele.
 *
 * NÃO RODA EM DESENVOLVIMENTO. Sem app empacotado não há `app-update.yml`, e o
 * electron-updater estoura logo na primeira checagem — barulho num lugar onde
 * não há nada para atualizar.
 */

// O electron-updater é CommonJS e não expõe named exports para o bundle ESM do
// electron-vite; desestruturar do default é o acesso que funciona nos dois.
const { autoUpdater } = electronUpdater;

/** Quanto tempo depois de abrir o app a primeira checagem acontece. */
const ATRASO_INICIAL_MS = 20_000;

/**
 * De quanto em quanto tempo checa de novo.
 *
 * Seis horas, e não quinze minutos: uma live dura horas e o vendedor deixa o
 * app aberto o dia todo. Checagem frequente não entrega a correção mais cedo
 * (ela só é aplicada no fechamento) e só gastaria banda de quem está
 * transmitindo vídeo ao vivo pela mesma conexão.
 */
const INTERVALO_MS = 6 * 60 * 60 * 1000;

let estado: EstadoAtualizacao = { situacao: 'ociosa', versao: null, erro: null };

export function estadoDaAtualizacao(): EstadoAtualizacao {
  return estado;
}

/**
 * Liga o updater e passa a avisar a janela a cada mudança de estado.
 *
 * A janela é recebida por função porque ela pode ser recriada (o `activate` do
 * macOS) — guardar a referência aqui deixaria o updater falando com uma janela
 * destruída.
 */
export function iniciarAtualizador(obterJanela: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;

  // Baixa sozinho, mas NUNCA instala por conta própria enquanto o app está
  // aberto: é o que garante que nenhum reinício aconteça no meio de uma live.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const anunciar = (proximo: EstadoAtualizacao): void => {
    estado = proximo;
    const janela = obterJanela();
    if (janela && !janela.isDestroyed()) {
      janela.webContents.send('atualizacao:mudou', proximo);
    }
  };

  autoUpdater.on('update-available', (info) => {
    anunciar({ situacao: 'baixando', versao: info.version ?? null, erro: null });
  });

  autoUpdater.on('update-not-available', () => {
    anunciar({ situacao: 'ociosa', versao: null, erro: null });
  });

  autoUpdater.on('update-downloaded', (info) => {
    anunciar({ situacao: 'pronta', versao: info.version ?? null, erro: null });
  });

  autoUpdater.on('error', (erro: Error) => {
    /*
     * Falha de atualização NÃO vira tela de erro.
     *
     * O app continua inteiro na versão atual: sem internet, com o GitHub fora
     * do ar ou com o pacote corrompido, o vendedor não perdeu nada e não tem
     * nada a fazer a respeito. Alarmar sobre isso no meio de uma live seria
     * gastar a atenção dele com o único problema da tela que não é dele.
     * O estado fica guardado para o rodapé e para o relato de suporte.
     */
    anunciar({ situacao: 'falhou', versao: null, erro: erro.message });
  });

  const checar = (): void => {
    autoUpdater.checkForUpdates().catch(() => {
      // O handler de 'error' acima já registrou; aqui só evitamos a rejeição
      // não tratada derrubar o processo principal.
    });
  };

  setTimeout(checar, ATRASO_INICIAL_MS).unref();
  setInterval(checar, INTERVALO_MS).unref();
}

/**
 * Aplica a atualização já baixada e reabre o app.
 *
 * Só é chamado pelo botão do painel — jamais por conta própria. `quitAndInstall`
 * dispara o `before-quit` do app, e é ele que encerra a run no backend: a live
 * fecha pelo caminho normal, não por um processo morto no meio de um heartbeat.
 */
export function instalarAgora(): void {
  if (estado.situacao !== 'pronta') return;
  autoUpdater.quitAndInstall();
}
