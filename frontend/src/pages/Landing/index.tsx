import {
  AutoFixHighRounded,
  BoltRounded,
  GroupsRounded,
  InsightsRounded,
  LocalFireDepartmentRounded,
  OndemandVideoRounded,
  PlayArrowRounded,
  StyleRounded,
  TrendingUpRounded,
} from '@mui/icons-material';
import { Box, Button, Chip, Container, Grid, Stack, Typography } from '@mui/material';
import { ReactNode } from 'react';
import { Link as RouterLink, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

// Paleta local da landing: página dark independente do tema claro do app.
const ink = '#0d0e14';
const inkSoft = '#14161f';
const line = 'rgba(255,255,255,0.08)';
const textDim = 'rgba(255,255,255,0.64)';
const red = '#fe2c55';
const cyan = '#25f4ee';

const gradientText = {
  background: `linear-gradient(92deg, ${red} 0%, #ff7a9c 45%, ${cyan} 100%)`,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
} as const;

const glass = {
  border: `1px solid ${line}`,
  borderRadius: 4,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
  backdropFilter: 'blur(12px)',
} as const;

const FEATURES: Array<{ icon: ReactNode; title: string; desc: string }> = [
  {
    icon: <LocalFireDepartmentRounded />,
    title: 'Produtos em alta',
    desc: 'Ranking diário dos produtos que mais vendem no TikTok Shop, com receita estimada, comissão e velocidade de crescimento.',
  },
  {
    icon: <OndemandVideoRounded />,
    title: 'Vídeos que vendem',
    desc: 'Descubra os vídeos com maior conversão por nicho e entenda os ganchos, formatos e CTAs que estão funcionando agora.',
  },
  {
    icon: <GroupsRounded />,
    title: 'Radar de criadores',
    desc: 'Encontre criadores por nicho, engajamento e GMV para fechar parcerias antes da concorrência.',
  },
  {
    icon: <AutoFixHighRounded />,
    title: 'Estúdio IA',
    desc: 'Gere roteiros de vídeo prontos para gravar a partir de qualquer produto — gancho, corpo e CTA em segundos.',
  },
  {
    icon: <StyleRounded />,
    title: 'Cofre de prompts',
    desc: 'Biblioteca de prompts testados para criativos, legendas e respostas de comentários que aumentam a conversão.',
  },
  {
    icon: <InsightsRounded />,
    title: 'Tendências antecipadas',
    desc: 'Sinais de tendência antes do pico: monitore categorias, hashtags e sons em ascensão para chegar primeiro.',
  },
];

const STEPS = [
  { n: '01', title: 'Descubra', desc: 'Filtre os produtos em alta por nicho, comissão e concorrência.' },
  { n: '02', title: 'Analise', desc: 'Veja os vídeos e criadores que já provaram que o produto vende.' },
  { n: '03', title: 'Crie', desc: 'Gere o roteiro com IA e publique antes do mercado saturar.' },
];

function MockRow({ name, growth, revenue, w }: { name: string; growth: string; revenue: string; w: number }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 1.1, borderBottom: `1px solid ${line}` }}>
      <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, background: `linear-gradient(135deg, ${red}33, ${cyan}33)` }} />
      <Box flex={1} minWidth={0}>
        <Typography fontSize={13} fontWeight={700} color="#fff" noWrap>{name}</Typography>
        <Box sx={{ mt: 0.6, height: 4, borderRadius: 2, width: `${w}%`, background: `linear-gradient(90deg, ${red}, ${cyan})` }} />
      </Box>
      <Chip size="small" label={growth} sx={{ bgcolor: 'rgba(37,244,238,0.12)', color: cyan, fontWeight: 700, height: 22 }} />
      <Typography fontSize={13} fontWeight={700} color="#fff" sx={{ width: 72, textAlign: 'right' }}>{revenue}</Typography>
    </Stack>
  );
}

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <Box sx={{ bgcolor: ink, color: '#fff', minHeight: '100vh', overflowX: 'hidden' }}>
      {/* Navbar */}
      <Box
        component="header"
        sx={{
          position: 'sticky', top: 0, zIndex: 10,
          borderBottom: `1px solid ${line}`,
          bgcolor: 'rgba(13,14,20,0.72)', backdropFilter: 'blur(14px)',
        }}
      >
        <Container maxWidth="lg">
          <Stack direction="row" alignItems="center" justifyContent="space-between" py={1.5}>
            <Typography fontWeight={800} fontSize={20} letterSpacing="-0.02em">
              Pik<Box component="span" sx={{ color: red }}>Pok</Box>
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button component={RouterLink} to="/login" sx={{ color: textDim, '&:hover': { color: '#fff' } }}>
                Entrar
              </Button>
              <Button
                component={RouterLink}
                to="/login"
                variant="contained"
                sx={{ bgcolor: red, '&:hover': { bgcolor: '#e0264c' }, px: 2.5 }}
              >
                Começar grátis
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* Hero */}
      <Box
        sx={{
          position: 'relative',
          background: `radial-gradient(55% 45% at 18% 8%, ${red}22 0%, transparent 60%), radial-gradient(45% 40% at 85% 30%, ${cyan}1e 0%, transparent 60%)`,
        }}
      >
        <Container maxWidth="lg" sx={{ pt: { xs: 8, md: 12 }, pb: { xs: 8, md: 10 } }}>
          <Grid container spacing={6} alignItems="center">
            <Grid item xs={12} md={6}>
              <Chip
                icon={<BoltRounded sx={{ fontSize: 16, color: `${cyan} !important` }} />}
                label="Inteligência de vendas para o TikTok Shop"
                sx={{ ...glass, color: textDim, mb: 3, px: 0.5, fontWeight: 600 }}
              />
              <Typography
                component="h1"
                sx={{ fontSize: { xs: 40, md: 56 }, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.03em' }}
              >
                Encontre o próximo produto <Box component="span" sx={gradientText}>viral</Box> antes de todo mundo
              </Typography>
              <Typography sx={{ color: textDim, fontSize: 18, mt: 3, maxWidth: 480, lineHeight: 1.6 }}>
                O PikPok monitora produtos, vídeos e criadores do TikTok Shop em tempo real e transforma
                dados em roteiros prontos para vender.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mt={4}>
                <Button
                  component={RouterLink}
                  to="/login"
                  size="large"
                  variant="contained"
                  sx={{
                    bgcolor: red, px: 4, py: 1.5, fontSize: 16,
                    boxShadow: `0 8px 30px ${red}66`,
                    '&:hover': { bgcolor: '#e0264c' },
                  }}
                >
                  Começar grátis
                </Button>
                <Button
                  component={RouterLink}
                  to="/login"
                  size="large"
                  startIcon={<PlayArrowRounded />}
                  sx={{ ...glass, color: '#fff', px: 3.5, py: 1.5, fontSize: 16 }}
                >
                  Ver demonstração
                </Button>
              </Stack>
              <Stack direction="row" spacing={{ xs: 3, md: 5 }} mt={6}>
                {[
                  ['12k+', 'produtos monitorados'],
                  ['48h', 'de antecedência média'],
                  ['3x', 'mais conversão'],
                ].map(([v, l]) => (
                  <Box key={l}>
                    <Typography fontSize={26} fontWeight={800} sx={gradientText}>{v}</Typography>
                    <Typography fontSize={13} color={textDim}>{l}</Typography>
                  </Box>
                ))}
              </Stack>
            </Grid>

            {/* Mock do dashboard */}
            <Grid item xs={12} md={6}>
              <Box sx={{ ...glass, p: 3, boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TrendingUpRounded sx={{ color: red }} />
                    <Typography fontWeight={700} fontSize={14}>Produtos em alta · hoje</Typography>
                  </Stack>
                  <Chip size="small" label="ao vivo" sx={{ bgcolor: `${red}1f`, color: red, fontWeight: 700, height: 22 }} />
                </Stack>
                <MockRow name="Mini ring light recarregável" growth="+312%" revenue="R$ 84k" w={92} />
                <MockRow name="Escova alisadora 3 em 1" growth="+248%" revenue="R$ 61k" w={78} />
                <MockRow name="Organizador de maquiagem" growth="+197%" revenue="R$ 47k" w={64} />
                <MockRow name="Garrafa térmica smart" growth="+154%" revenue="R$ 39k" w={51} />
                <Stack direction="row" spacing={2} mt={2.5}>
                  {[
                    ['GMV do nicho', 'R$ 2,4M'],
                    ['Vídeos novos', '1.283'],
                    ['Criadores ativos', '412'],
                  ].map(([l, v]) => (
                    <Box key={l} sx={{ ...glass, borderRadius: 3, p: 1.5, flex: 1 }}>
                      <Typography fontSize={11} color={textDim}>{l}</Typography>
                      <Typography fontSize={16} fontWeight={800}>{v}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Features */}
      <Container maxWidth="lg" sx={{ py: { xs: 8, md: 12 } }}>
        <Box textAlign="center" mb={7}>
          <Typography sx={{ color: cyan, fontWeight: 700, letterSpacing: '0.14em', fontSize: 13 }}>
            TUDO EM UM SÓ LUGAR
          </Typography>
          <Typography sx={{ fontSize: { xs: 30, md: 40 }, fontWeight: 800, letterSpacing: '-0.02em', mt: 1 }}>
            Da descoberta ao roteiro pronto
          </Typography>
        </Box>
        <Grid container spacing={3}>
          {FEATURES.map((f) => (
            <Grid item xs={12} sm={6} md={4} key={f.title}>
              <Box
                sx={{
                  ...glass, p: 3.5, height: '100%',
                  transition: 'transform .2s ease, border-color .2s ease',
                  '&:hover': { transform: 'translateY(-4px)', borderColor: `${red}55` },
                }}
              >
                <Box
                  sx={{
                    width: 44, height: 44, borderRadius: 3, display: 'grid', placeItems: 'center',
                    background: `linear-gradient(135deg, ${red}2e, ${cyan}2e)`, color: '#fff', mb: 2.5,
                  }}
                >
                  {f.icon}
                </Box>
                <Typography fontWeight={700} fontSize={17} mb={1}>{f.title}</Typography>
                <Typography fontSize={14.5} color={textDim} lineHeight={1.65}>{f.desc}</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Container>

      {/* Como funciona */}
      <Box sx={{ bgcolor: inkSoft, borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}` }}>
        <Container maxWidth="lg" sx={{ py: { xs: 8, md: 10 } }}>
          <Grid container spacing={4}>
            {STEPS.map((s) => (
              <Grid item xs={12} md={4} key={s.n}>
                <Typography sx={{ ...gradientText, fontSize: 40, fontWeight: 800 }}>{s.n}</Typography>
                <Typography fontWeight={700} fontSize={19} mt={1}>{s.title}</Typography>
                <Typography color={textDim} fontSize={15} mt={1} lineHeight={1.6}>{s.desc}</Typography>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* CTA final */}
      <Container maxWidth="md" sx={{ py: { xs: 10, md: 14 }, textAlign: 'center' }}>
        <Typography sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Pronto para vender <Box component="span" sx={gradientText}>antes da tendência</Box>?
        </Typography>
        <Typography color={textDim} fontSize={17} mt={2}>
          Crie sua conta em menos de um minuto. Sem cartão de crédito.
        </Typography>
        <Button
          component={RouterLink}
          to="/login"
          size="large"
          variant="contained"
          sx={{
            mt: 4, bgcolor: red, px: 5, py: 1.6, fontSize: 16,
            boxShadow: `0 8px 30px ${red}66`, '&:hover': { bgcolor: '#e0264c' },
          }}
        >
          Criar conta grátis
        </Button>
      </Container>

      {/* Footer */}
      <Box component="footer" sx={{ borderTop: `1px solid ${line}` }}>
        <Container maxWidth="lg">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems="center"
            justifyContent="space-between"
            spacing={2}
            py={4}
          >
            <Typography fontWeight={800}>
              Pik<Box component="span" sx={{ color: red }}>Pok</Box>
            </Typography>
            <Typography fontSize={13} color={textDim}>
              © {new Date().getFullYear()} PikPok — inteligência de produtos para o TikTok Shop
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
