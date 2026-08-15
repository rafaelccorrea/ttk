import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { StoreOpportunities, storesService } from '@/services/stores.service';
import { formatNumber } from '@/utils/format';

interface OpportunitiesTabProps {
  storeId: string;
  period: number;
  refreshKey: number;
}

/**
 * Cruzamento entre o catálogo real da loja e o radar de produtos em alta.
 * É o que a plataforma faz e o Seller Center não: apontar o que falta vender.
 */
export function OpportunitiesTab({
  storeId,
  period,
  refreshKey,
}: OpportunitiesTabProps) {
  const [data, setData] = useState<StoreOpportunities | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    storesService
      .opportunities(storeId, period)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [storeId, period, refreshKey]);

  if (loading) return <BrandLoader label="Cruzando com o radar..." />;
  if (!data) return null;

  return (
    <>
      <Box mb={4}>
        <Box display="flex" alignItems="center" gap={1} mb={0.5}>
          <TrendingUpRoundedIcon color="primary" />
          <Typography variant="h6">Em alta e você ainda não vende</Typography>
        </Box>
        <Typography color="text.secondary" mb={2}>
          Produtos subindo no radar da PikPok que não encontramos no seu
          catálogo.
        </Typography>

        {data.missing.length === 0 ? (
          <Typography color="text.secondary">
            Seu catálogo já cobre os produtos em alta do período.
          </Typography>
        ) : (
          <Grid container spacing={2.5}>
            {data.missing.map((item) => (
              <Grid item xs={12} sm={6} md={4} key={item.productId}>
                <Card
                  component={Link}
                  to={`/produtos/${item.productId}`}
                  sx={{
                    height: '100%',
                    display: 'block',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  {item.imageUrl && (
                    <Box
                      component="img"
                      src={item.imageUrl}
                      alt={item.title}
                      sx={{
                        width: '100%',
                        height: 150,
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  )}
                  <CardContent>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mb: 1,
                      }}
                    >
                      {item.title}
                    </Typography>
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                      <Chip size="small" label={item.category} />
                      <Typography variant="caption" color="text.secondary">
                        {formatNumber(item.salesPeriod)} vendas
                      </Typography>
                      {item.growthPct !== null && (
                        <Chip
                          size="small"
                          label={`${item.growthPct > 0 ? '+' : ''}${item.growthPct}%`}
                          sx={{
                            height: 20,
                            fontWeight: 700,
                            bgcolor:
                              item.growthPct > 0
                                ? 'rgba(22,163,74,0.12)'
                                : 'rgba(220,38,38,0.10)',
                            color: item.growthPct > 0 ? '#16a34a' : '#dc2626',
                          }}
                        />
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      <Box display="flex" alignItems="center" gap={1} mb={0.5}>
        <CheckCircleRoundedIcon sx={{ color: '#16a34a' }} />
        <Typography variant="h6">Em alta e você já vende</Typography>
      </Box>
      <Typography color="text.secondary" mb={2}>
        Priorize anúncio e estoque nesses — a demanda já está subindo.
      </Typography>

      {data.selling.length === 0 ? (
        <Typography color="text.secondary">
          Nenhum produto do radar bateu com o seu catálogo.
        </Typography>
      ) : (
        <Grid container spacing={1.5}>
          {data.selling.map((item) => (
            <Grid item xs={12} md={6} key={item.productId}>
              <Card>
                <CardContent
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.75 }}
                >
                  <Box flexGrow={1} minWidth={0}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {item.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      seu SKU: {item.sku}
                    </Typography>
                  </Box>
                  <Chip size="small" label={item.category} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </>
  );
}
