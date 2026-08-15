import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import RadarRoundedIcon from '@mui/icons-material/RadarRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Grid,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { tiktokProfileUrl } from '@/utils/tiktok';
import { StatCard } from '@/components/ui/StatCard';
import { useAuth } from '@/contexts/AuthContext';
import { analyticsService, Overview } from '@/services/analytics.service';
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
                    width: 32,
                    height: 32,
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
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
              sx={{
                borderRadius: 3,
                aspectRatio: '3 / 4',
                background: gradientFor(v.category),
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                p: 1.5,
              }}
            >
              <Chip
                size="small"
                label={v.category}
                sx={{
                  alignSelf: 'flex-start',
                  bgcolor: 'rgba(255,255,255,0.2)',
                  color: '#fff',
                  fontWeight: 600,
                }}
              />
              <Box>
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
                <Typography
                  component="a"
                  href={tiktokProfileUrl(v.creatorHandle)}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="caption"
                  sx={{
                    opacity: 0.85,
                    color: 'inherit',
                    textDecoration: 'none',
                    '&:hover': { opacity: 1, textDecoration: 'underline' },
                  }}
                >
                  @{v.creatorHandle}
                </Typography>
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      <SectionHeader title="Top Criadores" to="/criadores" />
      <Card>
        <Stack divider={<Box borderBottom="1px solid rgba(22,24,35,0.08)" />}>
          {overview?.topCreators.map((c) => (
            <Box key={c.id} display="flex" alignItems="center" gap={2} px={2} py={1.25}>
              <Avatar
                sx={{
                  width: 36,
                  height: 36,
                  fontSize: 15,
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #fe2c55, #00c2bb)',
                }}
              >
                {c.name.charAt(0).toUpperCase()}
              </Avatar>
              <Box minWidth={0} flex={1}>
                <Typography fontWeight={600} noWrap>
                  {c.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  <Box
                    component="a"
                    href={tiktokProfileUrl(c.handle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      color: 'inherit',
                      textDecoration: 'none',
                      '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                    }}
                  >
                    @{c.handle}
                  </Box>
                  {' · '}
                  {formatNumber(c.followers)} seguidores
                </Typography>
              </Box>
              <Typography fontWeight={700} color="secondary.main">
                {formatCurrency(c.gmvPeriod)}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Card>

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
    </>
  );
}
