import { CssBaseline, ThemeProvider } from '@mui/material';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { theme } from './theme/theme';

const raiz = document.getElementById('root');
// Sem o nó não há como montar nada, e falhar aqui com mensagem clara é melhor
// do que uma tela branca sem explicação.
if (!raiz) throw new Error('Elemento #root não encontrado no index.html.');

createRoot(raiz).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
