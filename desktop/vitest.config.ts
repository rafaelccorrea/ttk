/// <reference types="vitest" />
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Config separada do `electron.vite.config.ts` de propósito.
 *
 * Aquele arquivo descreve TRÊS builds (main, preload, renderer) e o Vitest não
 * sabe escolher entre eles — apontar o teste para lá faria o runner herdar a
 * config do renderer, com o plugin de React e a raiz em `src/renderer`, e o
 * teste do main passaria a rodar num contexto de navegador que o `node:crypto`
 * e o `electron` não têm.
 *
 * O ambiente padrão é `node` porque tudo que está sob teste hoje é do processo
 * principal. Os poucos casos que precisam de DOM — o esqueleto de HTML, que por
 * natureza roda dentro da página do TikTok — pedem jsdom por arquivo, com o
 * comentário `@vitest-environment jsdom` no topo.
 */
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
