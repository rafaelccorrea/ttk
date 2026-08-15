import { createTheme } from '@mui/material';

// Tema claro com as cores do TikTok: vermelho #FE2C55, ciano #25F4EE, preto #161823.
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#fe2c55' },
    secondary: { main: '#00c2bb' }, // ciano TikTok escurecido p/ contraste no branco
    success: { main: '#16a34a' },
    error: { main: '#dc2626' },
    background: { default: '#fafafa', paper: '#ffffff' },
    divider: 'rgba(22,24,35,0.08)',
    text: {
      primary: '#161823',
      secondary: '#73747b',
    },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 800, letterSpacing: '-0.02em' },
    h5: { fontWeight: 800, letterSpacing: '-0.02em' },
    h6: { fontWeight: 700, letterSpacing: '-0.01em' },
    overline: { letterSpacing: '0.12em', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(22,24,35,0.08)',
          boxShadow: '0 1px 3px rgba(22,24,35,0.05)',
          transition: 'border-color .15s ease, transform .15s ease, box-shadow .15s ease',
          '&:hover': {
            borderColor: 'rgba(22,24,35,0.16)',
            boxShadow: '0 6px 20px rgba(22,24,35,0.08)',
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 10 },
        containedPrimary: {
          boxShadow: '0 4px 18px rgba(254,44,85,0.30)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          border: '1px solid rgba(22,24,35,0.12)',
          color: '#73747b',
          '&.Mui-selected': {
            backgroundColor: 'rgba(254,44,85,0.10)',
            color: '#fe2c55',
            '&:hover': { backgroundColor: 'rgba(254,44,85,0.16)' },
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: 'rgba(22,24,35,0.08)' },
      },
    },
  },
});

export type AppTheme = typeof theme;
