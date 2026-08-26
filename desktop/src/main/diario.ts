import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O diário do app — a auditoria automática de erro do desktop.
 *
 * POR QUE EXISTE
 * --------------
 * O copiloto foi desenhado para NÃO cair no meio da live: chat que não conecta
 * reconecta em silêncio, lote que falha é descartado, campo de comentário que
 * some vira painel. Cada uma dessas decisões está certa — e todas juntas
 * produzem um app que fica mudo numa live cheia de pergunta sem deixar rastro
 * nenhum (foi exatamente o que aconteceu em 2026-08-26, quando o servidor de
 * assinatura do webcast passou a responder 404 e ninguém soube por horas).
 *
 * Este módulo é o rastro. Dois destinos, cada um com um papel:
 *
 *  1. ARQUIVO LOCAL (`<userData>/logs/copiloto.log`): tudo que o processo
 *     principal escreve em `console.warn`/`console.error`, mais exceção não
 *     tratada e rejeição perdida. É o que se pede ao vendedor quando o suporte
 *     precisa entender o que houve — e, por ser local, pode ser verboso.
 *
 *  2. BACKEND (`erro_desktop` em `live_run_events`): só os erros de PRODUTO —
 *     os que o app já classificou como "avisar o vendedor" (`avisarErro`,
 *     degradação para painel) — e só durante uma run. É o que aparece na
 *     auditoria da live na web sem ninguém precisar pedir arquivo a ninguém.
 *     Deduplicado e com teto por run: um webcast reconectando a cada 30s por
 *     uma hora é UM erro, não cento e vinte linhas.
 *
 * NADA de dado de espectador passa por aqui: as mensagens de erro do app são
 * sobre o app (conexão, seletor, HTTP), nunca sobre o conteúdo do chat.
 */

const TAMANHO_MAXIMO_BYTES = 2 * 1024 * 1024;
const JANELA_DEDUP_MS = 5 * 60_000;
const TETO_POR_RUN = 30;

type Nivel = 'info' | 'warn' | 'error';

export type RemetenteDeErro = (origem: string, mensagem: string) => Promise<void>;

let arquivo: string | null = null;
let remetente: RemetenteDeErro | null = null;
/** `origem|mensagem` → quando foi enviado pela última vez. */
const enviados = new Map<string, number>();
let enviadosNaRun = 0;

/** Caminho do arquivo em uso, ou `null` antes de `iniciarDiario`. */
export function caminhoDoDiario(): string | null {
  return arquivo;
}

/**
 * Liga o diário: cria a pasta, intercepta o console e captura o que o Node
 * deixaria passar. Chamar uma vez, o mais cedo possível no `whenReady`.
 */
export function iniciarDiario(pasta: string): string {
  mkdirSync(pasta, { recursive: true });
  arquivo = join(pasta, 'copiloto.log');

  const original = {
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    escrever('warn', formatar(args));
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    escrever('error', formatar(args));
  };
  // `info` não vai para o arquivo: é o ruído do dia a dia, e um diário que
  // cresce 2 MB por live deixa de ser lido.

  // Sem estes dois, uma exceção fora de `try` derruba o processo e a live
  // junto — e o vendedor não fica sabendo nem o quê nem por quê. Registrar e
  // seguir é a escolha certa para um app cujo trabalho é continuar de pé.
  process.on('uncaughtException', (erro) => {
    escrever('error', `[uncaughtException] ${detalhar(erro)}`);
  });
  process.on('unhandledRejection', (motivo) => {
    escrever('error', `[unhandledRejection] ${detalhar(motivo)}`);
  });

  escrever('info', `diário iniciado (pid ${process.pid})`);
  return arquivo;
}

/**
 * Quem leva o erro ao backend. É injetado pelo copiloto porque só ele sabe se
 * há run aberta e tem o cliente autenticado — o diário não conhece a API.
 */
export function definirRemetente(fn: RemetenteDeErro | null): void {
  remetente = fn;
}

/** Zera o teto e a dedup: cada run começa com a cota inteira. */
export function novaRunNoDiario(): void {
  enviados.clear();
  enviadosNaRun = 0;
}

/**
 * Um erro de produto: vai para o arquivo E, se houver run e cota, para o
 * backend. `origem` é curta e estável (`copiloto`, `envio`, `chat`) — é por
 * ela que a auditoria agrupa.
 */
export function registrarErro(origem: string, mensagem: string): void {
  const texto = String(mensagem ?? '').trim();
  if (!texto) return;
  escrever('error', `[${origem}] ${texto}`);

  if (!remetente) return;
  const chave = `${origem}|${texto}`;
  const agora = Date.now();
  const ultimo = enviados.get(chave);
  if (ultimo !== undefined && agora - ultimo < JANELA_DEDUP_MS) return;
  if (enviadosNaRun >= TETO_POR_RUN) return;

  enviados.set(chave, agora);
  enviadosNaRun += 1;
  // O envio nunca pode virar um segundo erro: se o backend está fora, o
  // arquivo já tem o registro e é isso.
  void remetente(origem.slice(0, 40), texto.slice(0, 500)).catch((erro) => {
    escrever('warn', `[diario] não subiu erro ao backend: ${detalhar(erro)}`);
  });
}

function escrever(nivel: Nivel, texto: string): void {
  if (!arquivo) return;
  try {
    rotacionarSePreciso(arquivo);
    appendFileSync(arquivo, `${new Date().toISOString()} [${nivel}] ${texto}\n`);
  } catch {
    // Disco cheio ou pasta sem permissão: o diário não pode derrubar o app.
  }
}

/** Passou de 2 MB, vira `.1.log` (um só de histórico) e recomeça. */
function rotacionarSePreciso(caminho: string): void {
  if (!existsSync(caminho)) return;
  if (statSync(caminho).size < TAMANHO_MAXIMO_BYTES) return;
  renameSync(caminho, caminho.replace(/\.log$/, '.1.log'));
}

function formatar(args: unknown[]): string {
  return args.map(detalhar).join(' ');
}

function detalhar(valor: unknown): string {
  if (valor instanceof Error) return valor.stack ?? valor.message;
  if (typeof valor === 'string') return valor;
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}
