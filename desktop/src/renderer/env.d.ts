/// <reference types="vite/client" />
import type { PikPokDesktopApi } from '@shared/desktop-api';

/**
 * A ponte que o preload injeta em `window`. Fica OPCIONAL de propósito: o
 * painel também abre num `vite dev` fora do Electron, e nesse caso `window.pikpok`
 * não existe — tipar como sempre presente esconderia esse caso do compilador.
 *
 * O tipo vem de `@shared`, e não do preload, para que declarar a janela não
 * arraste os tipos do `electron` para dentro do renderer — que não tem, e não
 * pode ter, nada do Electron ao alcance.
 */
declare global {
  interface Window {
    readonly pikpok?: PikPokDesktopApi;
  }
}

export {};
