import { Card, CardContent, Typography } from '@mui/material';

interface StatCardProps {
  label: string;
  value: string | number;
  helper?: string;
  accent?: boolean;
}

// Componente reutilizável para métricas (views, crescimento, vendas...).
export function StatCard({ label, value, helper, accent }: StatCardProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ py: 2.5 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          display="block"
          lineHeight={1.6}
        >
          {label}
        </Typography>
        <Typography
          variant="h4"
          sx={{ color: accent ? 'primary.main' : 'text.primary' }}
        >
          {value}
        </Typography>
        {helper && (
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            {helper}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
