/**
 * O tema do copiloto — e ele NÃO é mais a cópia do tema do site.
 *
 * Até aqui este arquivo era um espelho de `frontend/src/theme/theme.ts`, e a
 * consequência apareceu na janela: um painel branco de 40% grudado na
 * BrowserView do TikTok, que é preta. O site é lido de dia, no navegador, entre
 * outras abas brancas; este painel é lido ao vivo, com a luz baixa, ao lado de
 * uma transmissão. São dois contextos diferentes e por isso duas peles
 * diferentes — o que continua idêntico é a MARCA: vermelho #FE2C55, ciano
 * #25F4EE e a mesma família tipográfica.
 *
 * As versões de `@mui/material` e `@emotion/*` seguem casadas com as do
 * frontend, então componentes ainda podem viajar de lá para cá sem adaptação.
 */
import { createTheme, alpha } from '@mui/material';

/* -------------------------------------------------------------- as cores */

/** Vermelho da marca. É o acento, nunca o fundo de uma tela inteira. */
const VERMELHO = '#fe2c55';
/** Ciano da marca. No escuro ele volta ao tom original, sem o escurecimento
 *  que o fundo branco do site exigia para dar contraste. */
const CIANO = '#25f4ee';

/**
 * A escala de superfícies, do fundo da janela para a frente.
 *
 * São quatro degraus e não um cinza só porque a profundidade, no escuro, é a
 * única coisa que separa um card do fundo: sombra em cima de preto não se vê.
 * Quem sobe de degrau é quem está mais perto do vendedor.
 */
const FUNDO = '#0b0c10';
const SUPERFICIE = '#131519';
const SUPERFICIE_ALTA = '#191c22';
const SUPERFICIE_TOPO = '#20242c';

const TEXTO = '#f2f3f5';
const TEXTO_FRACO = '#9096a1';
const BORDA = 'rgba(255,255,255,0.08)';
const BORDA_FORTE = 'rgba(255,255,255,0.14)';

const SUCESSO = '#22c55e';
const ERRO = '#ff4d5e';
const ATENCAO = '#fbbf24';

/**
 * Os tokens exportados existem para as telas pararem de escrever
 * `rgba(22,24,35,0.04)` na mão. Cor literal espalhada por doze arquivos foi o
 * que fez a versão anterior ficar impossível de repintar de uma vez.
 */
export const cores = {
  vermelho: VERMELHO,
  ciano: CIANO,
  fundo: FUNDO,
  superficie: SUPERFICIE,
  superficieAlta: SUPERFICIE_ALTA,
  superficieTopo: SUPERFICIE_TOPO,
  borda: BORDA,
  bordaForte: BORDA_FORTE,
  sucesso: SUCESSO,
  erro: ERRO,
  atencao: ATENCAO,
  /** O gradiente da marca, usado em fios de 1px e em texto — nunca em área. */
  gradiente: `linear-gradient(120deg, ${VERMELHO} 0%, ${CIANO} 100%)`,
} as const;

/** Fundo de vidro: superfície translúcida + desfoque do que está atrás. */
export const vidro = {
  backgroundColor: alpha('#ffffff', 0.04),
  backdropFilter: 'blur(18px) saturate(1.4)',
  border: `1px solid ${BORDA}`,
} as const;

/**
 * Um brilho colorido por baixo de um elemento, no lugar da sombra preta.
 *
 * Sombra escura sobre fundo escuro não existe; o que dá relevo aqui é luz. É
 * assim que a escalação salta do cockpit sem precisar de uma borda de 2px.
 */
export const brilho = (cor: string, forca = 0.35): string =>
  `0 8px 32px ${alpha(cor, forca)}`;

/* --------------------------------------------------------------- o tema */

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: VERMELHO, contrastText: '#ffffff' },
    secondary: { main: CIANO, contrastText: '#06131a' },
    success: { main: SUCESSO },
    warning: { main: ATENCAO },
    error: { main: ERRO },
    background: { default: FUNDO, paper: SUPERFICIE },
    divider: BORDA,
    text: { primary: TEXTO, secondary: TEXTO_FRACO },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: '"Inter", "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif',
    h4: { fontWeight: 800, letterSpacing: '-0.025em' },
    h5: { fontWeight: 800, letterSpacing: '-0.025em', fontSize: '1.45rem' },
    h6: { fontWeight: 750, letterSpacing: '-0.015em' },
    subtitle1: { fontWeight: 650, letterSpacing: '-0.01em' },
    subtitle2: { fontWeight: 700, letterSpacing: '-0.005em' },
    // O overline é o rótulo de seção do cockpit ("precisa de você"). Ele é
    // pequeno de propósito: quem está ao vivo lê o conteúdo, não o título.
    overline: { letterSpacing: '0.14em', fontWeight: 700, fontSize: 10.5, lineHeight: 2 },
    caption: { letterSpacing: '0.005em' },
    button: { textTransform: 'none', fontWeight: 650, letterSpacing: '-0.005em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          WebkitTextSizeAdjust: '100%',
          scrollBehavior: 'smooth',
          '@media (prefers-reduced-motion: reduce)': { scrollBehavior: 'auto' },
          scrollbarWidth: 'thin',
          scrollbarColor: `${alpha('#ffffff', 0.16)} transparent`,
        },
        body: {
          overflowX: 'hidden',
          overscrollBehaviorY: 'none',
          // Antialias: no escuro o texto fica gordo demais sem isso.
          WebkitFontSmoothing: 'antialiased',
          backgroundColor: FUNDO,
        },
        /*
         * A barra de rolagem some no repouso e só aparece com o ponteiro
         * dentro do bloco. Este painel tem três listas roláveis empilhadas em
         * 40% de largura: três barras permanentes seriam três faixas de ruído
         * competindo com as respostas.
         */
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': {
          background: alpha('#ffffff', 0.10),
          borderRadius: 999,
          border: '2px solid transparent',
          backgroundClip: 'content-box',
        },
        '*:hover::-webkit-scrollbar-thumb': { background: alpha('#ffffff', 0.20) },
        '*::-webkit-scrollbar-thumb:hover': { background: alpha('#ffffff', 0.30) },
        '*::-webkit-scrollbar-corner': { background: 'transparent' },
        // Nada aqui é para arrastar nem selecionar: é um painel de operação.
        // O texto das respostas reativa a seleção onde importa.
        '::selection': { background: alpha(VERMELHO, 0.35) },
        img: { maxWidth: '100%' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        // O `backgroundImage` do MUI escuro clareia o papel conforme a
        // elevação. Aqui a hierarquia é dada pelos tokens de superfície, na
        // mão, então o gradiente automático só atrapalharia.
        root: { backgroundImage: 'none' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: SUPERFICIE_ALTA,
          border: `1px solid ${BORDA}`,
          boxShadow: 'none',
          transition: 'border-color .18s ease, background-color .18s ease',
          '&:hover': { borderColor: BORDA_FORTE, backgroundColor: SUPERFICIE_TOPO },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          transition: 'background-color .18s ease, border-color .18s ease, box-shadow .2s ease, transform .12s ease',
          '&:active': { transform: 'scale(0.985)' },
        },
        sizeSmall: { padding: '5px 12px', fontSize: 13 },
        sizeLarge: { padding: '11px 20px', fontSize: 15 },
        containedPrimary: {
          boxShadow: brilho(VERMELHO, 0.30),
          '&:hover': { boxShadow: brilho(VERMELHO, 0.45) },
        },
        containedSuccess: { color: '#04140a' },
        outlined: {
          borderColor: BORDA_FORTE,
          '&:hover': { borderColor: alpha('#ffffff', 0.26), backgroundColor: alpha('#ffffff', 0.05) },
        },
        // `color="inherit"` é a ação discreta do app (Descartar, Cancelar,
        // Voltar): ela precisa ficar legível no escuro sem virar botão branco.
        textInherit: {
          color: TEXTO_FRACO,
          '&:hover': { color: TEXTO, backgroundColor: alpha('#ffffff', 0.06) },
        },
        outlinedInherit: {
          color: TEXTO_FRACO,
          borderColor: BORDA,
          '&:hover': { color: TEXTO, borderColor: BORDA_FORTE, backgroundColor: alpha('#ffffff', 0.05) },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: TEXTO_FRACO,
          transition: 'color .18s ease, background-color .18s ease',
          '&:hover': { color: TEXTO, backgroundColor: alpha('#ffffff', 0.07) },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: alpha('#ffffff', 0.04),
          transition: 'background-color .2s ease, box-shadow .2s ease',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: BORDA,
            transition: 'border-color .2s ease',
          },
          '&:hover': { backgroundColor: alpha('#ffffff', 0.06) },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: BORDA_FORTE },
          '&.Mui-focused': {
            backgroundColor: alpha('#ffffff', 0.07),
            boxShadow: `0 0 0 3px ${alpha(VERMELHO, 0.18)}`,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: VERMELHO,
            borderWidth: 1,
          },
          '&.Mui-disabled': { backgroundColor: alpha('#ffffff', 0.02) },
        },
        input: { '&::placeholder': { color: alpha(TEXTO_FRACO, 0.7), opacity: 1 } },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          color: TEXTO_FRACO,
          '&.Mui-focused': { color: VERMELHO },
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: { root: { marginLeft: 2, marginTop: 6, lineHeight: 1.45 } },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 14,
          marginTop: 6,
          backgroundColor: SUPERFICIE_TOPO,
          border: `1px solid ${BORDA_FORTE}`,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        },
        list: { padding: 6 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 9,
          fontSize: 14,
          minHeight: 38,
          '&:hover': { backgroundColor: alpha('#ffffff', 0.06) },
          '&.Mui-selected': {
            backgroundColor: alpha(VERMELHO, 0.16),
            '&:hover': { backgroundColor: alpha(VERMELHO, 0.22) },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        /*
         * Todo diálogo vive nos 40% da direita. O modal do MUI cobre a janela
         * inteira, mas os 60% da esquerda são a BrowserView do TikTok, que o
         * processo principal desenha POR CIMA deste documento — um diálogo
         * centralizado na janela aparece cortado ao meio, com metade escondida
         * atrás do vídeo. Alinhar o root ao painel é o que faz ele existir
         * inteiro no único pedaço de tela que é nosso.
         */
        root: { left: '60%' },
        paper: {
          backgroundImage: 'none',
          backgroundColor: SUPERFICIE_ALTA,
          border: `1px solid ${BORDA_FORTE}`,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: { backgroundColor: alpha('#05060a', 0.72), backdropFilter: 'blur(3px)' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 650, letterSpacing: '0.005em' },
        sizeSmall: { height: 22, fontSize: 11.5 },
        outlined: { borderColor: BORDA_FORTE },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        // Trilho mais escuro que o padrão do MUI: no desligado ele precisa
        // parecer desligado, e o cinza claro de fábrica lê como "ligado".
        track: { backgroundColor: alpha('#ffffff', 0.22), opacity: 1 },
        thumb: { boxShadow: '0 1px 3px rgba(0,0,0,0.6)' },
      },
    },
    MuiSlider: {
      styleOverrides: {
        root: { height: 5 },
        rail: { backgroundColor: alpha('#ffffff', 0.14), opacity: 1 },
        track: { border: 'none' },
        thumb: {
          width: 16,
          height: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
          '&:hover, &.Mui-focusVisible': { boxShadow: `0 0 0 8px ${alpha(VERMELHO, 0.16)}` },
          '&.Mui-active': { boxShadow: `0 0 0 12px ${alpha(VERMELHO, 0.20)}` },
        },
        mark: { backgroundColor: alpha('#ffffff', 0.22) },
        valueLabel: { backgroundColor: SUPERFICIE_TOPO, fontWeight: 700, borderRadius: 8 },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: BORDA } } },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 12, border: '1px solid', alignItems: 'center' },
        standardError: {
          backgroundColor: alpha(ERRO, 0.12),
          borderColor: alpha(ERRO, 0.35),
          color: '#ffd7db',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: SUPERFICIE_TOPO,
          border: `1px solid ${BORDA_FORTE}`,
          fontSize: 12,
          fontWeight: 550,
          borderRadius: 8,
          padding: '6px 10px',
        },
      },
    },
    MuiCircularProgress: { styleOverrides: { root: { color: VERMELHO } } },
    MuiLink: {
      styleOverrides: {
        root: {
          color: CIANO,
          textDecorationColor: alpha(CIANO, 0.35),
          '&:hover': { textDecorationColor: CIANO },
        },
      },
    },
  },
});

export type AppTheme = typeof theme;
