import {
  Box,
  Button,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StatCard } from '@/components/ui/StatCard';
import { ProductDetail, productsService } from '@/services/products.service';
import { formatCurrency, formatNumber } from '@/utils/format';

// Sparkline simples em SVG a partir da série diária de vendas.
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 600;
  const height = 120;
  const max = Math.max(...values, 1);
  const points = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * width},${height - (v / max) * (height - 8) - 4}`,
    )
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 120 }}
      role="img"
      aria-label="Tendência de vendas"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#00c2bb"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState(30);
  const [product, setProduct] = useState<ProductDetail | null>(null);

  useEffect(() => {
    if (!id) return;
    productsService.detail(id, period).then(setProduct).catch(console.error);
  }, [id, period]);

  if (!product) {
    return <Typography color="text.secondary">Carregando...</Typography>;
  }

  return (
    <>
      <Button component={Link} to="/produtos" size="small" sx={{ mb: 2 }}>
        ← Voltar para produtos
      </Button>
      <Typography variant="h5" gutterBottom>
        {product.title}
      </Typography>
      <Typography color="text.secondary" gutterBottom>
        {product.storeName ?? '—'} · {product.category}
      </Typography>

      <Grid container spacing={2} sx={{ my: 1 }}>
        <Grid item xs={6} sm={3}>
          <StatCard label="Preço" value={formatCurrency(product.price)} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="Vendas (período)"
            value={formatNumber(product.salesPeriod)}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="Faturamento (período)"
            value={formatCurrency(product.revenuePeriod)}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="Radar score"
            value={product.radarScore ?? '—'}
            helper={product.rating ? `avaliação ${product.rating}★` : undefined}
          />
        </Grid>
      </Grid>

      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="h6">Tendência de vendas</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={period}
          onChange={(_e, value) => value && setPeriod(value)}
        >
          <ToggleButton value={7}>7d</ToggleButton>
          <ToggleButton value={30}>30d</ToggleButton>
          <ToggleButton value={90}>90d</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Sparkline values={product.series.map((s) => s.sales)} />

      <Box mt={2}>
        <Button
          component={Link}
          to={`/estudio?productId=${product.id}&type=live`}
          variant="contained"
          sx={{ mr: 1 }}
        >
          Roteirizar live
        </Button>
        <Button
          component={Link}
          to={`/estudio?productId=${product.id}&type=video`}
          variant="outlined"
        >
          Roteirizar vídeo
        </Button>
      </Box>
    </>
  );
}
