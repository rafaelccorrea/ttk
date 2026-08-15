import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import RadarRoundedIcon from '@mui/icons-material/RadarRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Link as MuiLink,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { TikTokPlayer } from '@/components/ui/TikTokPlayer';
import { displayHandle, proxyImage, tiktokProfileUrl, tiktokSearchUrl } from '@/utils/tiktok';
import { SmartImage } from '@/components/ui/SmartImage';
import { StatCard } from '@/components/ui/StatCard';
import { useAuth } from '@/contexts/AuthContext';
import { analyticsService, Overview, TopVideo } from '@/services/analytics.service';
import { formatCurrency, formatNumber } from '@/utils/format';

const GRADIENTS = [
  'linear-gradient(135deg, #fe2c55 0%, #7c3aed 100%)',
  'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #f59e0b 100%)',
];
function gradientFor(category: string): string {
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return GRADIENTS[hash % GRADIENTS.length];
}

function SectionHeader({ title, to }: { title: string; to: string }) {
  return (
    <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mt: 4, mb: 1.5 }}>
      <Typography variant="h6">{title}</Typography>
      <MuiLink component={Link} to={to} underline="hover" fontWeight={600} fontSize={14}>
        Ver todos
      </MuiLink>
    </Box>
  );
}

export function DashboardPage() {
  const { email } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  // Todo vídeo com id é tocável: o MP4 é resolvido sob demanda pelo player.
  const playableVideos = (overview?.topVideos ?? []).filter((v) => v.id);

  useEffect(() => {
    analyticsService.overview().then(setOverview).catch(console.error);
  }, []);

  const firstName = email ? email.split('@')[0] : 'criador';

  if (!overview) {
    return <BrandLoader label="Carregando seu painel..." minHeight={480} />;
  }

  return (
    <>
      <Typography variant="h5" fontWeight={700}>
        Olá, {firstName}
      </Typography>
      <Typography color="text.secondary" gutterBottom>
        Hoje é um ótimo dia para vender no TikTok Shop
      </Typography>

      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Faturamento rastreado"
            value={overview ? formatCurrency(overview.totalRevenue) : '—'}
            helper="acumulado do catálogo"
            accent
            icon={<PaymentsRoundedIcon fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Vendas rastreadas"
            value={overview ? formatNumber(overview.totalSales) : '—'}
            helper="unidades acumuladas"
            icon={<ShoppingBagRoundedIcon fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Produtos no radar"
            value={overview ? overview.totalProducts : '—'}
            helper="atualizado todo dia"
            icon={<RadarRoundedIcon fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Categorias"
            value={overview ? overview.totalCategories : '—'}
            helper="nichos monitorados"
            icon={<CategoryRoundedIcon fontSize="small" />}
          />
        </Grid>
      </Grid>

      <SectionHeader title="Top Produtos · 7 dias" to="/produtos" />
      <Stack spacing={1.25}>
        {overview?.topProducts.map((p, i) => (
          <Card key={p.id}>
            <CardActionArea component={Link} to={`/produtos/${p.id}`}>
              <Box display="flex" alignItems="center" gap={2} px={2} py={1.25}>
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                    color: i === 0 ? '#fff' : 'text.secondary',
                    background:
                      i === 0
                        ? 'linear-gradient(135deg, #fe2c55, #7c3aed)'
                        : 'rgba(22,24,35,0.05)',
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </Box>
                {/* Miniatura real do produto */}
                <Box
                  sx={{
                    position: 'relative',
                    width: 56,
                    height: 56,
                    borderRadius: 2.5,
                    flexShrink: 0,
                    overflow: 'hidden',
                    bgcolor: '#f6f6f8',
                    display: 'grid',
                    placeItems: 'center',
                    border: '1px solid rgba(22,24,35,0.06)',
                  }}
                >
                  <SmartImage
                    src={p.imageUrl ? proxyImage(p.imageUrl) : null}
                    alt={p.title}
                    objectFit="contain"
                    fallback={
                      <ShoppingBagRoundedIcon sx={{ color: 'rgba(22,24,35,0.25)' }} />
                    }
                  />
                </Box>
                <Box minWidth={0} flex={1}>
                  <Typography fontWeight={600} noWrap>
                    {p.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {formatNumber(p.salesPeriod)} vendas · {formatCurrency(p.revenuePeriod)}
                  </Typography>
                </Box>
                {p.growthPct !== null && (
                  <Chip
                    size="small"
                    label={`${p.growthPct >= 0 ? '+' : ''}${p.growthPct}%`}
                    sx={{
                      fontWeight: 700,
                      bgcolor:
                        p.growthPct >= 0 ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)',
                      color: p.growthPct >= 0 ? 'success.main' : 'error.main',
                    }}
                  />
                )}
                <Tooltip title="Ver no TikTok">
                  <IconButton
                    component="a"
                    href={p.tiktokUrl ?? tiktokSearchUrl(p.title)}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="small"
                    onClick={(e) => {
                      // Não navega para o detalhe ao clicar no link externo.
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(p.tiktokUrl ?? tiktokSearchUrl(p.title), '_blank', 'noopener,noreferrer');
                    }}
                    sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                  >
                    <OpenInNewRoundedIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </CardActionArea>
          </Card>
        ))}
      </Stack>

      <SectionHeader title="Vídeos em alta" to="/videos" />
      <Grid container spacing={2}>
        {overview?.topVideos.map((v) => (
          <Grid item xs={12} sm={6} md={2.4} key={v.id}>
            <Box
              // Com MP4 disponível, toca dentro da plataforma; senão abre o TikTok.
              component={v.id ? 'div' : 'a'}
              href={v.id ? undefined : (v.videoUrl ?? tiktokProfileUrl(v.creatorHandle))}
              target={v.id ? undefined : '_blank'}
              rel={v.id ? undefined : 'noopener noreferrer'}
              onClick={
                v.id
                  ? () => setPlayingIndex(playableVideos.findIndex((p) => p.id === v.id))
                  : undefined
              }
              sx={{
                position: 'relative',
                overflow: 'hidden',
                cursor: 'pointer',
                borderRadius: 3,
                aspectRatio: '3 / 4',
                // A thumb entrou como <SmartImage> (abaixo) em vez de
                // background-image: só assim dá para saber quando carregou.
                // O gradiente fica como fundo e como fallback.
                background: gradientFor(v.category),
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                p: 1.5,
                textDecoration: 'none',
                transition: 'transform .2s ease, box-shadow .2s ease',
                '&:hover': { transform: 'translateY(-3px)', boxShadow: '0 12px 30px rgba(22,24,35,0.25)' },
              }}
            >
              <SmartImage
                src={
                  v.thumbnailUrl ?? v.productImageUrl
                    ? proxyImage(v.thumbnailUrl ?? v.productImageUrl)
                    : null
                }
                alt={v.caption ?? ''}
                tone="dark"
              />
              {/* Escurece o pé do card para o texto branco ter contraste sobre
                  a thumb. Fica acima da imagem e abaixo do conteúdo. */}
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(180deg, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.72))',
                  pointerEvents: 'none',
                }}
              />

              <Chip
                size="small"
                label={v.category}
                sx={{
                  position: 'relative',
                  alignSelf: 'flex-start',
                  bgcolor: 'rgba(255,255,255,0.2)',
                  color: '#fff',
                  fontWeight: 600,
                }}
              />
              <Box sx={{ position: 'relative' }}>
                <Typography variant="h6" fontWeight={800} lineHeight={1.1}>
                  {formatNumber(v.views)}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.85 }}>
                  views
                </Typography>
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
                <Typography variant="caption" sx={{ opacity: 0.85 }}>
                  {displayHandle(v.creatorHandle)}
                </Typography>
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      <SectionHeader title="Top Criadores" to="/criadores" />
      <Grid container spacing={2}>
        {overview?.topCreators.map((c, i) => (
          <Grid item xs={12} sm={6} md={2.4} key={c.id}>
            <Card sx={{ height: '100%', '&:hover': { transform: 'translateY(-3px)' } }}>
              {/* Card inteiro abre o criador dentro do sistema */}
              <CardActionArea
                component={Link}
                to={`/criadores?search=${encodeURIComponent(c.handle.replace(/^@+/, ''))}`}
                sx={{
                  p: 2.5,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  position: 'relative',
                }}
              >
                <Chip
                  size="small"
                  label={`#${i + 1}`}
                  sx={{
                    position: 'absolute',
                    top: 10,
                    left: 10,
                    fontWeight: 800,
                    bgcolor: i === 0 ? 'primary.main' : 'rgba(22,24,35,0.06)',
                    color: i === 0 ? '#fff' : 'text.secondary',
                  }}
                />
                {/* Perfis com avatar vêm da ingestão real; os demais são dados demo do seed. */}
                {c.avatarUrl && (
                  <Tooltip title="Abrir perfil no TikTok">
                    <IconButton
                      component="a"
                      href={tiktokProfileUrl(c.handle)}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="small"
                      onClick={(e) => e.stopPropagation()}
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        color: 'text.secondary',
                        '&:hover': { color: 'primary.main' },
                      }}
                    >
                      <OpenInNewRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                )}
                {/* Antes era um <Avatar>: ele já caía na inicial quando a foto
                    falhava, mas não sinalizava o carregamento. Aqui o
                    SmartImage cuida dos três estados e a inicial vira o
                    fallback. */}
                <Box
                  sx={{
                    position: 'relative',
                    width: 76,
                    height: 76,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    background: 'linear-gradient(135deg, #fe2c55, #00c2bb)',
                    border: '3px solid #fff',
                    boxShadow: '0 6px 18px rgba(22,24,35,0.14)',
                    transition: 'transform .2s ease',
                    '&:hover': { transform: 'scale(1.06)' },
                  }}
                >
                  <SmartImage
                    src={c.avatarUrl ? proxyImage(c.avatarUrl) : null}
                    alt={c.name}
                    tone="dark"
                    fallback={
                      <Box
                        sx={{ fontSize: 30, fontWeight: 800, color: '#fff' }}
                      >
                        {c.name.charAt(0).toUpperCase()}
                      </Box>
                    }
                  />
                </Box>
                <Typography fontWeight={700} mt={1.5} noWrap maxWidth="100%">
                  {c.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {displayHandle(c.handle)}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {formatNumber(c.followers)} seguidores
                </Typography>
                <Typography fontWeight={800} color="secondary.main" mt={1}>
                  {formatCurrency(c.gmvPeriod)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  GMV 30 dias
                </Typography>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2} sx={{ mt: 3, mb: 2 }}>
        <Grid item xs={12} sm={6}>
          <Button
            component={Link}
            to="/estudio"
            variant="contained"
            size="large"
            fullWidth
            startIcon={<AutoAwesomeRoundedIcon />}
            sx={{ py: 1.75, fontWeight: 700 }}
          >
            Roteirizar com IA
          </Button>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Button
            component={Link}
            to="/prompts"
            variant="outlined"
            size="large"
            fullWidth
            startIcon={<LockRoundedIcon />}
            sx={{ py: 1.75, fontWeight: 700 }}
          >
            Cofre de Prompts
          </Button>
        </Grid>
      </Grid>

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
