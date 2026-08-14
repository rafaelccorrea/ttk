import {
  Grid,
  Link as MuiLink,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatCard } from '@/components/ui/StatCard';
import { analyticsService, Overview } from '@/services/analytics.service';
import { formatCurrency, formatNumber } from '@/utils/format';

export function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    analyticsService.overview().then(setOverview).catch(console.error);
  }, []);

  return (
    <>
      <Typography variant="h5" gutterBottom>
        Visão geral
      </Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={3}>
          <StatCard
            label="Faturamento rastreado"
            value={overview ? formatCurrency(overview.totalRevenue) : '—'}
            helper="acumulado do catálogo"
          />
        </Grid>
        <Grid item xs={12} sm={3}>
          <StatCard
            label="Vendas rastreadas"
            value={overview ? formatNumber(overview.totalSales) : '—'}
            helper="unidades acumuladas"
          />
        </Grid>
        <Grid item xs={12} sm={3}>
          <StatCard
            label="Produtos no radar"
            value={overview ? overview.totalProducts : '—'}
            helper="atualizado todo dia"
          />
        </Grid>
        <Grid item xs={12} sm={3}>
          <StatCard
            label="Categorias"
            value={overview ? overview.totalCategories : '—'}
          />
        </Grid>
      </Grid>

      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
        Top produtos (7 dias)
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>Produto</TableCell>
            <TableCell align="right">Vendas</TableCell>
            <TableCell align="right">Faturamento</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {overview?.topProducts.map((p, i) => (
            <TableRow key={p.id}>
              <TableCell>{i + 1}</TableCell>
              <TableCell>
                <MuiLink component={Link} to={`/produtos/${p.id}`}>
                  {p.title}
                </MuiLink>
              </TableCell>
              <TableCell align="right">{formatNumber(p.salesPeriod)}</TableCell>
              <TableCell align="right">
                {formatCurrency(p.revenuePeriod)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
