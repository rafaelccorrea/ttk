import { createTheme } from '@mui/material';

/** Breakpoint mobile (abaixo de `sm` = 600px) usado nos ajustes responsivos. */
const SM_DOWN = '@media (max-width:599.95px)';

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
    // Títulos encolhem no mobile para não quebrar em várias linhas.
    h4: {
      fontWeight: 800,
      letterSpacing: '-0.02em',
      [SM_DOWN]: { fontSize: '1.6rem' },
    },
    h5: {
      fontWeight: 800,
      letterSpacing: '-0.02em',
      [SM_DOWN]: { fontSize: '1.3rem' },
    },
    h6: {
      fontWeight: 700,
      letterSpacing: '-0.01em',
      [SM_DOWN]: { fontSize: '1.075rem' },
    },
    overline: { letterSpacing: '0.12em', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { WebkitTextSizeAdjust: '100%' },
        // Trava o estouro horizontal: no mobile qualquer elemento largo demais
        // rola dentro do próprio container, nunca empurra a página.
        body: { overflowX: 'hidden' },
        // Evita o zoom automático do iOS ao focar campos (<16px dispara zoom).
        'input, select, textarea': { [SM_DOWN]: { fontSize: '16px' } },
        img: { maxWidth: '100%' },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          [SM_DOWN]: { margin: 16, width: 'calc(100% - 32px)', maxWidth: '100%' },
        },
      },
    },
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
        root: {
          borderRadius: 10,
          transition: 'transform .15s ease, box-shadow .2s ease, background-color .2s ease',
          '&:hover': { transform: 'translateY(-1px)' },
          '&:active': { transform: 'scale(0.98)' },
        },
        containedPrimary: {
          boxShadow: '0 4px 18px rgba(254,44,85,0.30)',
          '&:hover': { boxShadow: '0 8px 26px rgba(254,44,85,0.40)' },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: 'rgba(22,24,35,0.03)',
          transition: 'background-color .2s ease, box-shadow .2s ease, border-color .2s ease',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(22,24,35,0.10)',
            transition: 'border-color .2s ease',
          },
          '&:hover': { backgroundColor: 'rgba(22,24,35,0.05)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(22,24,35,0.18)' },
          '&.Mui-focused': {
            backgroundColor: '#ffffff',
            boxShadow: '0 0 0 4px rgba(254,44,85,0.12)',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1.5 },
          '&.Mui-disabled': { backgroundColor: 'rgba(22,24,35,0.02)' },
        },
        input: {
          '&::placeholder': { color: '#9a9ba1', opacity: 1 },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          color: '#73747b',
          '&.Mui-focused': { color: '#fe2c55' },
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 14,
          marginTop: 6,
          border: '1px solid rgba(22,24,35,0.08)',
          boxShadow: '0 12px 32px rgba(22,24,35,0.12)',
        },
        list: { padding: 6 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 9,
          fontSize: 14,
          fontWeight: 500,
          minHeight: 38,
          '&.Mui-selected': {
            backgroundColor: 'rgba(254,44,85,0.10)',
            color: '#fe2c55',
            fontWeight: 700,
            '&:hover': { backgroundColor: 'rgba(254,44,85,0.16)' },
          },
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color .15s ease',
          '&:hover': { backgroundColor: 'rgba(22,24,35,0.025)' },
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          textDecorationColor: 'rgba(254,44,85,0.3)',
          transition: 'text-decoration-color .2s ease',
          '&:hover': { textDecorationColor: '#fe2c55' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    // Segmented control: o grupo vira a "pílula" e cada botão é uma aba interna.
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(22,24,35,0.04)',
          borderRadius: 999,
          padding: 3,
          gap: 2,
          '& .MuiToggleButtonGroup-grouped': {
            border: 0,
            margin: 0, // MUI aplica margin negativa p/ colar as bordas; aqui não há bordas.
            borderRadius: '999px !important',
          },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: 13.5,
          color: '#73747b',
          border: 0,
          borderRadius: 999,
          padding: '6px 16px',
          [SM_DOWN]: { padding: '6px 11px', fontSize: 12.5 },
          transition: 'background-color .18s ease, color .18s ease, box-shadow .18s ease',
          '&:hover': { backgroundColor: 'rgba(22,24,35,0.06)' },
          '&.Mui-selected': {
            backgroundColor: '#ffffff',
            color: '#fe2c55',
            fontWeight: 700,
            boxShadow: '0 1px 3px rgba(22,24,35,0.12)',
            '&:hover': { backgroundColor: '#ffffff' },
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(22,24,35,0.08)',
          [SM_DOWN]: { padding: '8px 10px' },
        },
      },
    },
  },
});

export type AppTheme = typeof theme;
