import { render, screen } from '@testing-library/react';
import { AppThemeProvider } from '@/theme/AppThemeProvider';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('renderiza label e valor', () => {
    render(
      <AppThemeProvider>
        <StatCard label="Views totais" value="1.2M" helper="últimos 7 dias" />
      </AppThemeProvider>,
    );

    expect(screen.getByText('Views totais')).toBeInTheDocument();
    expect(screen.getByText('1.2M')).toBeInTheDocument();
    expect(screen.getByText('últimos 7 dias')).toBeInTheDocument();
  });
});
