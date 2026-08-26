import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * Por que electron-vite e não "vite + tsc" na mão.
 *
 * São TRÊS alvos com regras de empacotamento diferentes: o main roda em Node
 * (CommonJS, com `electron` e os módulos nativos ficando FORA do bundle), o
 * preload roda num contexto isolado que não aceita ESM, e o renderer é uma SPA
 * de navegador com HMR. Montar isso à mão são três configs de Vite mais um
 * orquestrador que sobe o Electron só depois que o preload terminou de
 * compilar — precisamente o que o electron-vite já faz, e o que quebra em
 * silêncio quando é caseiro (o sintoma clássico é o preload servido velho e a
 * ponte do contextBridge sumindo sem erro nenhum).
 *
 * O type-check fica separado, no `tsc --noEmit` do script `build`: o esbuild
 * embaixo do Vite apaga os tipos sem conferi-los, então sem essa etapa o build
 * passaria por cima de erro de tipo.
 */
export default defineConfig({
  main: {
    // `externalizeDepsPlugin` mantém as dependências reais fora do bundle do
    // main: electron-store espera ser resolvido do node_modules em tempo de
    // execução. A `tiktok-live-connector` 2.x é a EXCEÇÃO — ela é ESM-only, e
    // o main é CommonJS rodando no Node 20 do Electron 33, que não faz
    // `require()` de ESM. Fora do bundle ela estoura ERR_REQUIRE_ESM na
    // primeira live; empacotada, o Rollup a converte junto com o resto.
    plugins: [externalizeDepsPlugin({ exclude: ['tiktok-live-connector'] })],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
