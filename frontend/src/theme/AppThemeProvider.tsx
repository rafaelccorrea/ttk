import { CssBaseline, ThemeProvider } from '@mui/material';
import { ReactNode } from 'react';
import { ThemeProvider as StyledThemeProvider } from 'styled-components';
import { theme } from './theme';

interface Props {
  children: ReactNode;
}

// Provê o mesmo tema para componentes MUI e styled-components.
export function AppThemeProvider({ children }: Props) {
  return (
    <ThemeProvider theme={theme}>
      <StyledThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </StyledThemeProvider>
    </ThemeProvider>
  );
}
