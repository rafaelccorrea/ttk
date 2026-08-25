/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  /*
   * O terceiro argumento vazio carrega TODAS as variáveis do `.env`, não só as
   * de prefixo `VITE_`. É de propósito: `DEV_API_TARGET` decide para onde o
   * servidor de desenvolvimento encaminha, e isso nunca deve viajar dentro do
   * bundle — só variáveis `VITE_` chegam ao navegador, e esta não é uma delas.
   */
  const env = loadEnv(mode, process.cwd(), '');

  /**
   * Para onde o `/api` do ambiente de desenvolvimento aponta.
   *
   * O padrão é o backend local. Definindo `DEV_API_TARGET` no `.env`, a mesma
   * tela passa a falar com produção sem rebuild e sem tocar em código.
   *
   * Por que PROXY e não `VITE_API_URL` apontando direto para produção: o
   * backend só libera CORS para as origens configuradas, e `localhost` não está
   * entre elas — o navegador bloquearia toda chamada. Incluir `localhost` no
   * CORS de produção resolveria, mas ao custo de afrouxar produção por
   * conveniência de desenvolvimento. Com o proxy o navegador conversa só com
   * `localhost`, e quem fala com produção é o servidor de dev, onde CORS não se
   * aplica. Nada muda no ar.
   *
   * `changeOrigin` é obrigatório aqui: sem ele o `Host` continuaria sendo
   * `localhost:5173`, e a hospedagem não saberia qual site servir.
   */
  const alvoDaApi = env.DEV_API_TARGET || 'http://localhost:3000';

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': '/src' },
    },
    build: {
      /*
       * O bundle era um único arquivo de 1,2 MB: toda tela pagava o parse das
       * 30 páginas antes de pintar. As páginas pesadas viram `lazy` em
       * `routes/index.tsx`; aqui as bibliotecas ficam em chunks próprios, que
       * o navegador guarda em cache entre deploys enquanto elas não mudam.
       */
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            mui: ['@mui/material', '@emotion/react', '@emotion/styled'],
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: alvoDaApi,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/setupTests.ts',
    },
  };
});
