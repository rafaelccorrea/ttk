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
        scrollbarWidth: 'thin',
        '&::-webkit-scrollbar': { height: 6 },
        '&::-webkit-scrollbar-thumb': {
          background: 'rgba(22,24,35,0.18)',
          borderRadius: 3,
        },
      }}
    >
      {children}
    </Box>
  );
}
