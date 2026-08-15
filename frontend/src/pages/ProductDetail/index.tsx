import {
  Box,
  Button,
  Chip,
  Grid,
  Link as MuiLink,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { StatCard } from '@/components/ui/StatCard';
import { ProductDetail, productsService } from '@/services/products.service';
import { videosService, ViralVideo } from '@/services/videos.service';
import { formatCurrency, formatNumber } from '@/utils/format';
import { tiktokSearchUrl } from '@/utils/tiktok';

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
  const [videos, setVideos] = useState<ViralVideo[]>([]);

  useEffect(() => {
    if (!id) return;
    productsService.detail(id, period).then(setProduct).catch(console.error);
  }, [id, period]);

  useEffect(() => {
    if (!id) return;
    videosService
      .list({ productId: id, limit: 6 })
      .then((res) => setVideos(res.items))
      .catch(console.error);
  }, [id]);

  if (!product) {
    return <BrandLoader label="Carregando produto..." minHeight={420} />;
  }

  return (
    <>
      <Button component={Link} to="/produtos" size="small" sx={{ mb: 2 }}>
        ← Voltar para produtos
      </Button>
      <Box display="flex" gap={2.5} alignItems="center" mb={1}>
        {product.imageUrl && (
          <Box
            component="img"
            src={product.imageUrl}
            alt={product.title}
            sx={{
              width: 96,
              height: 96,
              borderRadius: 3,
              objectFit: 'cover',
              border: '1px solid rgba(22,24,35,0.08)',
              boxShadow: '0 4px 14px rgba(22,24,35,0.10)',
            }}
          />
        )}
        <Box>
          <Typography variant="h5" gutterBottom>
            {product.title}
          </Typography>
          <Typography color="text.secondary">
            {product.storeName ?? '—'} · {product.category}
          </Typography>
        </Box>
      </Box>

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

      <Box display="flex" alignItems="center" justifyContent="space-between" mt={3} mb={1.5}>
        <Typography variant="h6">Vídeos deste produto</Typography>
        {videos.length > 0 && (
          <MuiLink component={Link} to="/videos" underline="hover" fontWeight={600} fontSize={14}>
            Ver todos os vídeos
          </MuiLink>
        )}
      </Box>
      {videos.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nenhum vídeo vinculado ainda
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {videos.map((v) => (
            <Grid item xs={12} sm={6} md={4} key={v.id}>
              <Box
                sx={{
                  border: '1px solid rgba(22,24,35,0.08)',
                  borderRadius: 3,
                  p: 1.5,
                  height: '100%',
                }}
              >
                <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                  <Typography fontWeight={800}>{formatNumber(v.views)} views</Typography>
                  <Chip
                    size="small"
                    label={formatCurrency(v.revenueEstimate)}
                    sx={{
                      fontWeight: 700,
                      bgcolor: 'rgba(0,194,187,0.12)',
                      color: 'secondary.main',
                    }}
                  />
                </Box>
                <Typography
                  variant="body2"
                  sx={{
                    mt: 0.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {v.caption}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  @{v.creatorHandle}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      )}

      <Box mt={3}>
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
          sx={{ mr: 1 }}
        >
          Roteirizar vídeo
        </Button>
        {/* Sem tiktokUrl próprio, cai para a busca real do TikTok pelo produto. */}
        <Button
          variant="outlined"
          color="secondary"
          href={product.tiktokUrl ?? tiktokSearchUrl(product.title)}
          target="_blank"
          rel="noopener noreferrer"
          endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 16 }} />}
        >
          {product.tiktokUrl ? 'Ver no TikTok Shop' : 'Buscar no TikTok'}
        </Button>
      </Box>
    </>
  );
}
