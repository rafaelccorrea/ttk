import InventoryRoundedIcon from '@mui/icons-material/Inventory2Rounded';
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded';
import PaidRoundedIcon from '@mui/icons-material/PaidRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { StatCard } from '@/components/ui/StatCard';
import {
  SkuPerformance,
  StoreOverview,
  storesService,
} from '@/services/stores.service';
import { formatMoney, formatNumber } from '@/utils/format';
import { ExportButton } from './ExportButton';

const CURVE_COLOR: Record<SkuPerformance['curve'], string> = {
  A: '#16a34a',
  B: '#f59e0b',
  C: '#94a3b8',
};

/** Série de faturamento como SVG — sem lib de gráfico no projeto. */
function RevenueSeries({
  series,
  currency,
}: {
  series: StoreOverview['series'];
  currency: string;
}) {
  if (series.length < 2) return null;

  const width = 640;
  const height = 120;
  const max = Math.max(...series.map((point) => point.revenue), 1);
  const step = width / (series.length - 1);
  const points = series
    .map(
      (point, index) =>
        `${index * step},${height - (point.revenue / max) * (height - 8) - 4}`,
    )
    .join(' ');

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box display="flex" alignItems="baseline" justifyContent="space-between">
          <Typography variant="h6">Faturamento por dia</Typography>
          <Typography variant="body2" color="text.secondary">
            pico: {formatMoney(max, currency)}
          </Typography>
        </Box>
        <Box
          component="svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          sx={{ width: '100%', height: 140, mt: 1 }}
        >
          <defs>
            <linearGradient id="storeRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fe2c55" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#fe2c55" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            points={`0,${height} ${points} ${width},${height}`}
            fill="url(#storeRevenueFill)"
          />
          <polyline
            points={points}
            fill="none"
            stroke="#fe2c55"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </Box>
        <Box display="flex" justifyContent="space-between" mt={0.5}>
          <Typography variant="caption" color="text.secondary">
            {new Date(series[0].date).toLocaleDateString('pt-BR')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {new Date(series[series.length - 1].date).toLocaleDateString('pt-BR')}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

interface OverviewTabProps {
  storeId: string;
  period: number;
  /** Muda quando uma importação termina, para recarregar os números. */
  refreshKey: number;
  onGoToImports: () => void;
  onGoToProducts: () => void;
}

export function OverviewTab({
  storeId,
  period,
  refreshKey,
  onGoToImports,
  onGoToProducts,
}: OverviewTabProps) {
  const [overview, setOverview] = useState<StoreOverview | null>(null);
  const [skus, setSkus] = useState<SkuPerformance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      storesService.overview(storeId, period),
      storesService.skus(storeId, period),
    ])
      .then(([data, performance]) => {
        setOverview(data);
        setSkus(performance);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [storeId, period, refreshKey]);

  if (loading) return <BrandLoader label="Carregando sua loja..." />;
  if (!overview) return null;

  const money = (value: number) => formatMoney(value, overview.currency);
  const noData = overview.ordersCount === 0 && overview.canceledCount === 0;

  if (noData) {
    return (
      <Alert
        severity="info"
        sx={{ borderRadius: 3, cursor: 'pointer' }}
        onClick={onGoToImports}
      >
        Nenhum pedido nos últimos {period} dias. Importe o relatório de pedidos
        na aba <strong>Importar</strong> para ver os números da loja.
      </Alert>
    );
  }

  return (
    <>
      <Grid container spacing={2.5} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            accent
            label="Faturamento bruto"
            value={money(overview.grossRevenue)}
            icon={<PaidRoundedIcon />}
            trend={
              overview.revenueGrowthPct === null
                ? undefined
                : `${overview.revenueGrowthPct > 0 ? '+' : ''}${overview.revenueGrowthPct}%`
            }
            helper={`${overview.ordersCount} pedidos · ${formatNumber(overview.unitsSold)} itens`}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Receita líquida"
            value={
              overview.netRevenue === null ? '—' : money(overview.netRevenue)
            }
            icon={<ReceiptLongRoundedIcon />}
            helper={
              overview.effectiveFeePct === null
                ? 'Importe o extrato de repasses'
                : `${overview.effectiveFeePct}% ficou em taxas`
            }
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Ticket médio"
            value={money(overview.avgTicket)}
            icon={<InventoryRoundedIcon />}
            helper={`${overview.cancelRatePct}% de cancelamento`}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="A enviar"
            value={overview.pendingShipment}
            icon={<LocalShippingRoundedIcon />}
            helper={
              overview.lateShipment > 0
                ? `${overview.lateShipment} com prazo estourado`
                : 'Nenhum atrasado'
            }
          />
        </Grid>
      </Grid>

      {overview.lateShipment > 0 && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 3 }}>
          <strong>{overview.lateShipment}</strong> pedido(s) passaram do prazo
          de envio. Atraso derruba a reputação da loja no TikTok Shop.
        </Alert>
      )}

      {overview.skusMissingCost > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 2, borderRadius: 3, cursor: 'pointer' }}
          onClick={onGoToProducts}
        >
          <strong>{overview.skusMissingCost}</strong> SKU(s) sem custo
          cadastrado — sem isso não dá para calcular a margem real. Preencha na
          aba <strong>Produtos</strong>.
        </Alert>
      )}

      {overview.lowStockCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2, borderRadius: 3 }}>
          <strong>{overview.lowStockCount}</strong> SKU(s) no estoque mínimo.
        </Alert>
      )}

      {overview.estimatedProfit !== null && (
        <Alert severity="success" sx={{ mb: 3, borderRadius: 3 }}>
          Lucro estimado no período:{' '}
          <strong>{money(overview.estimatedProfit)}</strong> — líquido repassado
          menos o custo dos produtos vendidos.
        </Alert>
      )}

      <Box mt={1}>
        <RevenueSeries series={overview.series} currency={overview.currency} />
      </Box>

      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        mb={1.5}
      >
        <Typography variant="h6">Curva ABC por faturamento</Typography>
        {skus.length > 0 && (
          <ExportButton
            label="Exportar curva ABC"
            onExport={() => storesService.exportSkus(storeId, period)}
          />
        )}
      </Box>
      {skus.length === 0 ? (
        <Typography color="text.secondary">
          Sem vendas por SKU no período.
        </Typography>
      ) : (
        <Card>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>SKU</TableCell>
                <TableCell>Produto</TableCell>
                <TableCell align="right">Vendas</TableCell>
                <TableCell align="right">Faturamento</TableCell>
                <TableCell align="right">Lucro</TableCell>
                <TableCell align="right">Margem</TableCell>
                <TableCell align="center">Curva</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {skus.slice(0, 20).map((row) => (
                <TableRow key={row.sku} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {row.sku}
                  </TableCell>
                  <TableCell>{row.title ?? '—'}</TableCell>
                  <TableCell align="right">{row.units}</TableCell>
                  <TableCell align="right">{money(row.revenue)}</TableCell>
                  <TableCell align="right">
                    {row.profit === null ? (
                      <Typography variant="body2" color="text.secondary">
                        sem custo
                      </Typography>
                    ) : (
                      money(row.profit)
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {row.marginPct === null ? (
                      '—'
                    ) : (
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        color={row.marginPct >= 0 ? 'success.main' : 'error.main'}
                      >
                        {row.marginPct}%
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      label={row.curve}
                      sx={{
                        fontWeight: 800,
                        color: CURVE_COLOR[row.curve],
                        bgcolor: `${CURVE_COLOR[row.curve]}1f`,
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
