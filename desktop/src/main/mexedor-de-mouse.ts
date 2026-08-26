import { execFile } from 'node:child_process';

/**
 * Mexe o cursor 1 px e volta, a cada minuto, enquanto o ajuste estiver ligado.
 *
 * POR QUE PROCESSO EXTERNO E NÃO UM PACOTE NATIVO
 * -----------------------------------------------
 * O Electron não tem API para mover o cursor; `powerSaveBlocker` só impede a
 * suspensão, mas não conta como "atividade" para o TikTok Studio, Teams etc.
 * Os pacotes que fazem isso (robotjs, nut-js) compilam binário nativo por
 * plataforma e engordam o instalador. Cada sistema tem uma ferramenta que já
 * vem (ou é trivial de instalar), então chamamos ela:
 *
 *   - Windows: PowerShell + System.Windows.Forms (sempre presente).
 *   - Linux:   `xdotool` (X11/XWayland). Sem ele, avisa no log uma vez e para.
 *   - macOS:   não há comando de fábrica que mova o cursor; fica sem efeito e
 *              avisa no log. Quando o app for distribuído para Mac, a saída é
 *              um binário nativo pequeno em `extraResources`.
 */
const INTERVALO_MS = 60_000;

const SCRIPT_WINDOWS = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$p=[System.Windows.Forms.Cursor]::Position',
  // Na borda direita o +1 é travado pelo sistema, então lá o passo vai para a esquerda.
  '$d=1;if($p.X -ge ([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Right-1)){$d=-1}',
  '[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(($p.X+$d),$p.Y)',
  'Start-Sleep -Milliseconds 80',
  '[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($p.X,$p.Y)',
].join(';');

interface Comando {
  readonly arquivo: string;
  readonly args: readonly string[];
}

function comandoDaPlataforma(): Comando | null {
  switch (process.platform) {
    case 'win32':
      return {
        arquivo: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SCRIPT_WINDOWS],
      };
    case 'linux':
      // Move relativo 1 px, espera e volta. `--sync` garante a ordem.
      return {
        arquivo: 'sh',
        args: ['-c', 'xdotool mousemove_relative --sync -- -1 0 && sleep 0.08 && xdotool mousemove_relative --sync -- 1 0'],
      };
    default:
      return null;
  }
}

let temporizador: NodeJS.Timeout | null = null;
let jaAvisouFalha = false;

function mexerUmaVez(): void {
  const comando = comandoDaPlataforma();
  if (!comando) return;
  execFile(
    comando.arquivo,
    [...comando.args],
    { windowsHide: true, timeout: 10_000 },
    (erro) => {
      if (!erro || jaAvisouFalha) return;
      // Um aviso só: o erro se repete a cada minuto e encheria o diário.
      jaAvisouFalha = true;
      console.warn(`[mouse] não consegui mexer o cursor (${process.platform}): ${erro.message}`);
    },
  );
}

/** Idempotente: chamar com `true` já ligado não cria um segundo temporizador. */
export function definirMexedorDeMouse(ligado: boolean): void {
  if (ligado && !temporizador) {
    if (!comandoDaPlataforma()) {
      console.warn(`[mouse] mexedor automático não tem suporte em ${process.platform}; ajuste ignorado`);
      return;
    }
    jaAvisouFalha = false;
    temporizador = setInterval(mexerUmaVez, INTERVALO_MS);
    console.info('[mouse] mexedor automático ligado (1 px a cada 60 s)');
  } else if (!ligado && temporizador) {
    clearInterval(temporizador);
    temporizador = null;
    console.info('[mouse] mexedor automático desligado');
  }
}
