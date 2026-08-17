import type { PikPokDesktopApi } from '@shared/desktop-api';

/**
 * O acesso do painel à ponte do preload.
 *
 * `window.pikpok` é opcional no tipo porque o painel também abre num `vite dev`
 * solto, fora do Electron — e é justamente esse caso que esta função existe
 * para tornar visível. A alternativa preguiçosa (`window.pikpok!`) trocaria
 * "ponte ausente" por `Cannot read properties of undefined`, um erro que não
 * diz nada a quem estiver com a tela na frente.
 */
export function obterPonte(): PikPokDesktopApi | null {
  return window.pikpok ?? null;
}

/**
 * A frase que qualquer tela mostra quando a ponte não está lá.
 *
 * É uma só e fica aqui porque, para o vendedor, o diagnóstico é sempre o
 * mesmo — o app não subiu inteiro — e a ação também: reabrir.
 */
export const SEM_PONTE =
  'O app não terminou de abrir. Feche e abra o PikPok Copiloto de novo; se continuar assim, reinstale pelo site.';
