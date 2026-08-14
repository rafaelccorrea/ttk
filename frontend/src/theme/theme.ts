import { createTheme } from '@mui/material';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#fe2c55' }, // vermelho TikTok
    secondary: { main: '#25f4ee' }, // ciano TikTok
    background: { default: '#121212', paper: '#1e1e1e' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
});

export type AppTheme = typeof theme;
