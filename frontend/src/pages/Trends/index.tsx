import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Link as MuiLink,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendsOverview, trendsService } from '@/services/trends.service';
import { tiktokHashtagUrl } from '@/utils/tiktok';
import { formatCurrency, formatNumber } from '@/utils/format';

function GrowthChip({ pct }: { pct: number | null }) {
  if (pct === null) return <Chip size="small" label="novo" color="secondary" sx={{ fontWeight: 700 }} />;
  const up = pct >= 0;
  return (
    <Chip
      size="small"
      icon={up ? <TrendingUpRoundedIcon /> : <TrendingDownRoundedIcon />}
      label={`${up ? '+' : ''}${pct}%`}
      sx={{
        fontWeight: 700,
        bgcolor: up ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)',
        color: up ? 'success.main' : 'error.main',
        '& .MuiChip-icon': { color: 'inherit' },
      }}
    />
  );
}

export function TrendsPage() {
  const [data, setData] = useState<TrendsOverview | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    trendsService
      .overview()
      .then(setData)
      .catch((err) => {
        console.error(err);
        setError(true);
      });
  }, []);

  if (error) {
    return (
      <Typography color="text.secondary">
        Não foi possível carregar as tendências agora — tente novamente em instantes.
      </Typography>
    );
  }

  return (
    <>
      <Typography variant="h5" gutterBottom>
        Tendências
      </Typography>
      <Typography color="text.secondary" mb={3}>
        Comparação dos últimos 7 dias com os 7 anteriores, calculada sobre as vendas reais do radar
        {data?.referenceDate ? ` (dados até ${data.referenceDate.split('-').reverse().join('/')})` : ''}.
      </Typography>

      {/* Hashtags em alta no TikTok (via ingestão do Creative Center) */}
      {data && data.curated.length > 0 && (
        <>
          <Typography variant="h6" mb={1.5}>
            Hashtags em alta no TikTok · Brasil
          </Typography>
          <Box display="flex" gap={1} flexWrap="wrap" mb={4}>
            {data.curated.map((t) => (
              <Chip
                key={t.id}
                component="a"
                href={tiktokHashtagUrl(t.hashtag ?? t.title)}
                target="_blank"
                rel="noopener noreferrer"
                clickable
                icon={<OpenInNewRoundedIcon sx={{ fontSize: 15 }} />}
                label={
                  <>
                    <Box component="span" fontWeight={700}>{t.hashtag ?? t.title}</Box>
                    {Number(t.views) > 0 && (
                      <Box component="span" sx={{ opacity: 0.7, ml: 0.75 }}>
                        {formatNumber(Number(t.views))} views
                      </Box>
                    )}
                  </>
                }
                sx={{
                  bgcolor: 'rgba(254,44,85,0.08)',
                  color: 'text.primary',
                  py: 2,
                  '&:hover': { bgcolor: 'rgba(254,44,85,0.16)' },
                }}
              />
            ))}
          </Box>
        </>
      )}

      {/* Categorias em movimento */}
      <Typography variant="h6" mb={1.5}>
        Categorias em movimento
      </Typography>
      <Grid container spacing={2} mb={4}>
        {!data
          ? Array.from({ length: 4 }).map((_, i) => (
              <Grid item xs={12} sm={6} md={3} key={i}>
                <Skeleton variant="rounded" height={120} />
              </Grid>
            ))
          : data.categories.map((c) => (
              <Grid item xs={12} sm={6} md={3} key={c.category}>
                <Card sx={{ height: '100%' }}>
                  <CardContent sx={{ py: 2 }}>
                    <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                      <Typography fontWeight={700} noWrap>
                        {c.category}
                      </Typography>
                      <GrowthChip pct={c.growthPct} />
                    </Box>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      {formatNumber(c.recentSales)} vendas · {formatCurrency(c.recentRevenue)} em 7 dias
                    </Typography>
                    {c.topProduct && (
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5} noWrap>
                        destaque: {c.topProduct}
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
      </Grid>

      {/* Produtos em ascensão */}
      <Typography variant="h6" mb={1}>
        Produtos em ascensão
      </Typography>
      {!data ? (
        <Skeleton variant="rounded" height={280} />
      ) : data.risingProducts.length === 0 ? (
        <Typography color="text.secondary">Sem dados suficientes nos últimos 14 dias.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Produto</TableCell>
              <TableCell>Categoria</TableCell>
              <TableCell align="right">Vendas (7d)</TableCell>
              <TableCell align="right">Receita (7d)</TableCell>
              <TableCell align="right">Crescimento</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.risingProducts.map((p, i) => (
              <TableRow key={p.id}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>
                  <MuiLink component={Link} to={`/produtos/${p.id}`}>
                    {p.title}
                  </MuiLink>
                </TableCell>
                <TableCell>{p.category}</TableCell>
                <TableCell align="right">{formatNumber(p.recentSales)}</TableCell>
                <TableCell align="right">{formatCurrency(p.recentRevenue)}</TableCell>
                <TableCell align="right">
                  <GrowthChip pct={p.growthPct} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
