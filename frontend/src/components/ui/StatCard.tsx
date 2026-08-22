import { Box, Card, CardContent, Chip, Typography } from '@mui/material';
import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  helper?: string;
  accent?: boolean;
  icon?: ReactNode;
  /** Variação percentual/textual exibida como chip (ex.: "+12%"). */
  trend?: string;
}

// Componente reutilizável para métricas (views, crescimento, vendas...).
export function StatCard({ label, value, helper, accent, icon, trend }: StatCardProps) {
  const up = trend?.trim().startsWith('+');
  return (
    <Card
      sx={{
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accent
            ? 'linear-gradient(90deg, #fe2c55, #25f4ee)'
            : 'transparent',
        },
        '&:hover': { transform: 'translateY(-3px)' },
      }}
    >
      <CardContent sx={{ py: 2.5 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography
            variant="overline"
            color="text.secondary"
            display="block"
            lineHeight={1.6}
          >
            {label}
          </Typography>
          {icon && (
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: 2.5,
                display: 'grid',
                placeItems: 'center',
                color: 'primary.main',
                background: 'linear-gradient(135deg, rgba(254,44,85,0.12), rgba(37,244,238,0.12))',
                flexShrink: 0,
              }}
            >
              {icon}
            </Box>
          )}
        </Box>
        <Box display="flex" alignItems="baseline" gap={1} mt={icon ? 0 : 0.25} flexWrap="wrap">
          <Typography
            variant="h4"
            sx={(theme) => ({
              color: accent ? 'primary.main' : 'text.primary',
              // Valores longos (R$ 1.234.567,89) estouravam o card no mobile.
              fontSize: { xs: '1.6rem', sm: theme.typography.h4.fontSize },
              overflowWrap: 'anywhere',
            })}
          >
            {value}
          </Typography>
          {trend && (
            <Chip
              size="small"
              label={trend}
              sx={{
                height: 22,
                fontWeight: 700,
                bgcolor: up ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)',
                color: up ? 'success.main' : 'error.main',
              }}
            />
          )}
        </Box>
        {helper && (
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            {helper}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
