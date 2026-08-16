import { Box } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * Envolve conteúdo largo (tabelas, faixas de chips) num container que rola
 * na horizontal no mobile, em vez de estourar a largura da página.
 */
export function ScrollX({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        // Não deixa o gesto horizontal virar "voltar página" no trackpad/touch.
        overscrollBehaviorX: 'contain',
        // A barra em si vem do estilo global (CssBaseline).
      }}
    >
      {children}
    </Box>
  );
}
