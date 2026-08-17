import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  CarteiraLive,
  ConfiguracoesCopiloto,
  EstadoAtivacao,
  EstadoConexao,
  BaseDeConhecimento,
  PikPokDesktopApi,
  SessaoDesktop,
} from '../shared/desktop-api';
import type { LiveEvent } from '../shared/live-events';

/**
 * A ponte entre o painel (renderer) e o processo principal.
 *
 * POR QUE contextIsolation LIGADO E nodeIntegration DESLIGADO NÃO SE DISCUTE
 * -------------------------------------------------------------------------
 * Este app carrega tiktok.com dentro dele. Com `nodeIntegration` ligado,
 * qualquer JavaScript que rode numa página do app ganha `require`, e com
 * `require` vem `child_process` — ou seja, execução de comando na máquina do
 * vendedor a partir de conteúdo web. Não é um risco teórico num app cujo
 * conteúdo principal é um site de terceiro, com anúncios, embeds e scripts que
 * mudam sem nos avisar.
 *
 * `contextIsolation` é a outra metade: sem ela, o preload e a página dividem o
 * MESMO contexto de JavaScript, e a página pode reescrever os protótipos que o
 * nosso código usa (o clássico é trocar `Array.prototype.map` e interceptar o
 * que passa por ele). Ligada, o que o `contextBridge` expõe é uma cópia
 * congelada, e a página não alcança nada além dela.
 *
 * Daí a regra desta API: MÍNIMA. Cada função aqui é uma porta que o conteúdo do
 * renderer atravessa. Nada de `invoke(canal, ...args)` genérico — isso seria
 * expor o IPC inteiro e devolver de volta tudo o que o isolamento comprou.
 *
 * E, repetindo o que está em src/main/index.ts: esta API é do PAINEL. A
 * BrowserView do TikTok é outro mundo e NUNCA pode recebê-la, nem em parte, nem
 * "temporariamente para depurar".
 *
 * O QUE NÃO ATRAVESSA
 * -------------------
 * O token do vendedor. Nenhuma função abaixo devolve credencial, URL de API ou
 * header: quem fala com o backend é o processo principal, e o painel recebe só
 * o resultado já em português e já no formato da tela. Isso é o que permite
 * dizer, sem ressalva, que um XSS no painel não vira uma sessão roubada.
 */

/**
 * Assinatura de um canal de eventos do main.
 *
 * O ouvinte do painel NÃO recebe o `IpcRendererEvent`: junto dele viajam
 * `sender` e `ports`, que são alças para o próprio IPC. Entregar isso ao
 * renderer devolveria pela porta dos fundos o acesso genérico que a API inteira
 * evita. Por isso o wrapper descarta o evento e passa só o payload.
 */
function assinar<T>(canal: string, ouvinte: (dados: T) => void): () => void {
  const alvo = (_evento: IpcRendererEvent, dados: T): void => ouvinte(dados);
  ipcRenderer.on(canal, alvo);
  // O cancelador é obrigatório e não é detalhe: sem ele, cada remontagem de
  // componente do React deixaria um ouvinte para trás, e o painel de uma live
  // de duas horas acumularia centenas deles processando o mesmo evento.
  return () => {
    ipcRenderer.removeListener(canal, alvo);
  };
}

const api: PikPokDesktopApi = {
  obterVersao: () => ipcRenderer.invoke('app:versao') as Promise<string>,
  plataforma: process.platform,

  iniciarAtivacao: () =>
    ipcRenderer.invoke('ativacao:iniciar') as Promise<EstadoAtivacao>,
  aoMudarAtivacao: (ouvinte) => assinar<EstadoAtivacao>('ativacao:estado', ouvinte),
  obterSessao: () =>
    ipcRenderer.invoke('sessao:obter') as Promise<SessaoDesktop | null>,
  sair: () => ipcRenderer.invoke('sessao:sair') as Promise<void>,
  abrirNoNavegador: (url) =>
    ipcRenderer.invoke('app:abrirNoNavegador', url) as Promise<void>,

  listarBases: () =>
    ipcRenderer.invoke('live:bases') as Promise<BaseDeConhecimento[]>,
  obterCarteiraLive: () =>
    ipcRenderer.invoke('live:carteira') as Promise<CarteiraLive>,
  conectar: (params) =>
    ipcRenderer.invoke('live:conectar', params) as Promise<EstadoConexao>,
  encerrar: (motivo) =>
    ipcRenderer.invoke('live:encerrar', motivo) as Promise<EstadoConexao>,
  pausar: (pausado) =>
    ipcRenderer.invoke('live:pausar', pausado) as Promise<EstadoConexao>,
  obterConexao: () =>
    ipcRenderer.invoke('live:conexao') as Promise<EstadoConexao>,
  aoMudarConexao: (ouvinte) => assinar<EstadoConexao>('live:conexao', ouvinte),

  aoReceberEvento: (ouvinte) => assinar<LiveEvent>('live:evento', ouvinte),

  copiarResposta: (replyId, texto) =>
    ipcRenderer.invoke('live:copiarResposta', { replyId, texto }) as Promise<void>,
  copiarTexto: (texto) =>
    ipcRenderer.invoke('live:copiarTexto', texto) as Promise<void>,
  resolverEscalacao: (chatMessageId, desfecho) =>
    ipcRenderer.invoke('live:resolverEscalacao', {
      chatMessageId,
      desfecho,
    }) as Promise<void>,

  lerConfiguracoes: () =>
    ipcRenderer.invoke('config:ler') as Promise<ConfiguracoesCopiloto>,
  salvarConfiguracoes: (valores) =>
    ipcRenderer.invoke('config:salvar', valores) as Promise<ConfiguracoesCopiloto>,
};

contextBridge.exposeInMainWorld('pikpok', api);

export type { PikPokDesktopApi };
