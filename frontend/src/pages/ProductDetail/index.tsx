import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import LiveTvRoundedIcon from '@mui/icons-material/LiveTvRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import RadarRoundedIcon from '@mui/icons-material/RadarRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Link as MuiLink,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { TikTokPlayer } from '@/components/ui/TikTokPlayer';
import { StatCard } from '@/components/ui/StatCard';
import { ProductDetail, productsService } from '@/services/products.service';
import { videosService, ViralVideo } from '@/services/videos.service';
import { formatCurrency, formatNumber } from '@/utils/format';
import { displayHandle, proxyImage, tiktokSearchUrl } from '@/utils/tiktok';

// Gradiente estável por categoria (mesmo padrão da página de Vídeos).
const VIDEO_GRADIENTS = [
  'linear-gradient(135deg, #fe2c55 0%, #7c3aed 100%)',
  'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #f59e0b 100%)',
];
function videoGradientFor(category: string): string {
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return VIDEO_GRADIENTS[hash % VIDEO_GRADIENTS.length];
}

// Gráfico de área com gradiente da marca a partir da série diária de vendas.
function TrendChart({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <Typography variant="body2" color="text.secondary" py={4} textAlign="center">
        Sem dados suficientes no período.
      </Typography>
    );
  }
  const width = 600;
  const height = 150;
  const max = Math.max(...values, 1);
  const pts = values.map(
    (v, i) =>
      [
        (i / (values.length - 1)) * width,
        height - (v / max) * (height - 16) - 6,
      ] as const,
  );
  const line = pts.map(([x, y]) => `${x},${y}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 170 }} role="img" aria-label="Tendência de vendas">
      <defs>
        <linearGradient id="pdArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fe2c55" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#fe2c55" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pdLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fe2c55" />
          <stop offset="100%" stopColor="#00c2bb" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#pdArea)" />
      <polyline points={line} fill="none" stroke="url(#pdLine)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={5} fill="#fe2c55" stroke="#fff" strokeWidth={2} />
    </svg>
  );
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState(30);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [videos, setVideos] = useState<ViralVideo[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [activeImage, setActiveImage] = useState(0);

  // Galeria = fotos coletadas + a capa, sem repetir. Se só existe a capa,
  // as miniaturas não aparecem.
  const gallery = Array.from(
    new Set([...(product?.images ?? []), ...(product?.imageUrl ? [product.imageUrl] : [])]),
  );
  // O MP4 é resolvido no play; basta ter id para ser tocável.
  const playableVideos = videos.filter((v) => v.id);

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
      <Button
        component={Link}
        to="/produtos"
        size="small"
        startIcon={<ArrowBackRoundedIcon />}
        sx={{ mb: 2, color: 'text.secondary' }}
      >
        Voltar para produtos
      </Button>

      {/* Hero: foto grande + resumo e ações */}
      <Card sx={{ mb: 3, overflow: 'hidden' }}>
        <Grid container>
          <Grid item xs={12} sm={4} md={3}>
            <Box
              sx={{
                bgcolor: '#f6f6f8',
                height: '100%',
                minHeight: { xs: 260, sm: 340 },
                display: 'grid',
                placeItems: 'center',
                p: 2,
              }}
            >
              {gallery.length > 0 ? (
                <Box sx={{ width: '100%' }}>
                  <Box
                    component="img"
                    src={proxyImage(gallery[activeImage] ?? gallery[0])}
                    alt={product.title}
                    sx={{
                      display: 'block',
                      mx: 'auto',
                      maxWidth: '100%',
                      maxHeight: 300,
                      objectFit: 'contain',
                    }}
                  />
                  {gallery.length > 1 && (
                    <Stack
                      direction="row"
                      spacing={1}
                      mt={1.5}
                      justifyContent="center"
                      flexWrap="wrap"
                      useFlexGap
                    >
                      {gallery.slice(0, 6).map((url, index) => (
                        <Box
                          key={url}
                          component="img"
                          src={proxyImage(url)}
                          alt={`${product.title} — foto ${index + 1}`}
                          onClick={() => setActiveImage(index)}
                          sx={{
                            width: 52,
                            height: 52,
                            objectFit: 'cover',
                            borderRadius: 1.5,
                            cursor: 'pointer',
                            bgcolor: '#fff',
                            border:
                              index === activeImage
                                ? '2px solid #fe2c55'
                                : '1px solid rgba(22,24,35,0.12)',
                            transition: 'border-color .15s ease',
                          }}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
              ) : (
                <ShoppingBagRoundedIcon sx={{ fontSize: 64, color: 'rgba(22,24,35,0.2)' }} />
              )}
            </Box>
          </Grid>
          <Grid item xs={12} sm={8} md={9}>
            <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
              <Stack direction="row" spacing={1} mb={1.5} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={product.category} sx={{ fontWeight: 700, bgcolor: 'rgba(254,44,85,0.08)', color: 'primary.main' }} />
                {product.rating && (
                  <Chip
                    size="small"
                    icon={<StarRoundedIcon sx={{ fontSize: 16, color: '#f59e0b !important' }} />}
                    label={product.rating}
                    sx={{ fontWeight: 700, bgcolor: 'rgba(245,158,11,0.10)' }}
                  />
                )}
                {product.radarScore !== null && (
                  <Chip
                    size="small"
                    icon={<RadarRoundedIcon sx={{ fontSize: 15, color: '#00c2bb !important' }} />}
                    label={`radar ${product.radarScore}`}
                    sx={{ fontWeight: 700, bgcolor: 'rgba(0,194,187,0.10)', color: 'secondary.main' }}
                  />
                )}
              </Stack>
              <Typography variant="h5" sx={{ lineHeight: 1.25 }}>
                {product.title}
              </Typography>
              <Typography color="text.secondary" mt={0.5}>
                {product.storeName ?? 'Loja não informada'}
              </Typography>
              <Typography variant="h4" mt={1.5} color="primary.main">
                {formatCurrency(product.price)}
              </Typography>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} mt={2.5}>
                <Button
                  component={Link}
                  to={`/estudio?productId=${product.id}&type=video`}
                  variant="contained"
                  startIcon={<AutoFixHighRoundedIcon />}
                >
                  Roteirizar vídeo
                </Button>
                <Button
                  component={Link}
                  to={`/estudio?productId=${product.id}&type=live`}
                  variant="outlined"
                  startIcon={<LiveTvRoundedIcon />}
                >
                  Roteirizar live
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
              </Stack>
            </CardContent>
          </Grid>
        </Grid>
      </Card>

      {/* Métricas do período */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="Vendas (período)"
            value={formatNumber(product.salesPeriod)}
            icon={<ShoppingBagRoundedIcon fontSize="small" />}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="Faturamento (período)"
            value={formatCurrency(product.revenuePeriod)}
            icon={<PaymentsRoundedIcon fontSize="small" />}
            accent
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="Preço médio"
            value={formatCurrency(product.price)}
            icon={<InsightsRoundedIcon fontSize="small" />}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            label="Radar score"
            value={product.radarScore ?? '—'}
            helper={product.rating ? `avaliação ${product.rating}★` : undefined}
            icon={<RadarRoundedIcon fontSize="small" />}
          />
        </Grid>
      </Grid>

      {/* Tendência */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
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
          <TrendChart values={product.series.map((s) => s.sales)} />
        </CardContent>
      </Card>

      {/* Vídeos do produto */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
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
          {videos.map((v) => {
            const playable = Boolean(v.id);
            return (
              <Grid item xs={6} sm={4} md={3} lg={2} key={v.id}>
                <Card
                  onClick={
                    playable
                      ? () => setPlayingIndex(playableVideos.findIndex((p) => p.id === v.id))
                      : undefined
                  }
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: playable ? 'pointer' : 'default',
                    '&:hover': playable ? { transform: 'translateY(-3px)' } : undefined,
                  }}
                >
                  {/* Miniatura vertical 9:16, como no feed do TikTok */}
                  <Box
                    sx={{
                      position: 'relative',
                      aspectRatio: '9 / 16',
                      maxHeight: 300,
                      // Capa: thumbnail do vídeo; sem ela, a foto do produto.
                      background: v.thumbnailUrl ?? v.productImageUrl ?? product.imageUrl
                        ? `linear-gradient(180deg, rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.65)), url(${proxyImage(
                            v.thumbnailUrl ?? v.productImageUrl ?? product.imageUrl,
                          )}) center/cover no-repeat`
                        : videoGradientFor(v.category),
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      p: 1.25,
                      overflow: 'hidden',
                    }}
                  >
                    <Chip
                      size="small"
                      icon={<VisibilityOutlinedIcon sx={{ fontSize: 15, color: '#fff !important' }} />}
                      label={formatNumber(v.views)}
                      sx={{
                        alignSelf: 'flex-start',
                        bgcolor: 'rgba(0,0,0,0.45)',
                        color: '#fff',
                        fontWeight: 700,
                        backdropFilter: 'blur(4px)',
                      }}
                    />
                    <Box
                      sx={{
                        alignSelf: 'center',
                        width: 46,
                        height: 46,
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fff',
                        bgcolor: playable ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)',
                        transition: 'transform .2s ease, background-color .2s ease',
                        '.MuiCard-root:hover &': playable
                          ? { transform: 'scale(1.12)', bgcolor: 'rgba(254,44,85,0.9)' }
                          : undefined,
                      }}
                    >
                      <PlayArrowRoundedIcon sx={{ fontSize: 30 }} />
                    </Box>
                    <Typography
                      sx={{
                        color: '#fff',
                        fontSize: 12.5,
                        fontWeight: 700,
                        textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                      }}
                      noWrap
                    >
                      {displayHandle(v.creatorHandle)}
                    </Typography>
                  </Box>

                  <CardContent sx={{ py: 1.5, flexGrow: 1 }}>
                    <Typography
                      sx={{
                        fontSize: 13.5,
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        minHeight: '2.8em',
                      }}
                    >
                      {v.caption}
                    </Typography>
                    {/* Sem faturamento por vídeo nesta lista.
                        O fornecedor atribui receita a poucos criativos: uns
                        cards mostravam "R$ 21,6 mil", os vizinhos não mostravam
                        nada, e a leitura virava "esse vendeu, aquele não" —
                        conclusão que o dado não sustenta. A régua confiável do
                        criativo aqui é o alcance, que aparece na capa. O
                        faturamento continua na página de Vídeos, onde a
                        comparação é entre vídeos e não dentro de um produto. */}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Player fullscreen estilo TikTok */}
      <TikTokPlayer
        videos={playableVideos}
        index={playingIndex}
        onIndexChange={setPlayingIndex}
        onClose={() => setPlayingIndex(null)}
      />
    </>
  );
}
