import {
  ArrowForwardRounded,
  AutoFixHighRounded,
  LoginRounded,
  BoltRounded,
  GroupsRounded,
  InsightsRounded,
  LocalFireDepartmentRounded,
  OndemandVideoRounded,
  PlayArrowRounded,
  RocketLaunchRounded,
  StyleRounded,
  TrendingUpRounded,
} from '@mui/icons-material';
import { Box, Button, Chip, Container, Grid, GlobalStyles, Stack, Typography } from '@mui/material';
import { ReactNode, useEffect, useRef, useState } from 'react';
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
  backgroundSize: '200% 100%',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  animation: 'lpGradient 6s ease infinite',
} as const;

const glass = {
  border: `1px solid ${line}`,
  borderRadius: 4,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
  backdropFilter: 'blur(12px)',
} as const;

const landingKeyframes = (
  <GlobalStyles
    styles={`
      @keyframes lpGradient { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
      @keyframes lpFadeUp { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes lpFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
      @keyframes lpFloatAlt { 0%,100% { transform: translateY(-6px) rotate(-2deg); } 50% { transform: translateY(8px) rotate(2deg); } }
      @keyframes lpPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(254,44,85,0.55); } 70% { box-shadow: 0 0 0 9px rgba(254,44,85,0); } }
      @keyframes lpMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      @keyframes lpBar { from { width: 0; } }
      @keyframes lpBlob { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(40px,-30px) scale(1.12); } 66% { transform: translate(-30px,24px) scale(0.94); } }
      @keyframes lpShine { from { transform: translateX(-120%) skewX(-18deg); } to { transform: translateX(240%) skewX(-18deg); } }
      @keyframes lpTicker { 0%, 18% { transform: translateY(0); } 25%, 43% { transform: translateY(-25%); } 50%, 68% { transform: translateY(-50%); } 75%, 93% { transform: translateY(-75%); } 100% { transform: translateY(-75%); } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; }
      }
    `}
  />
);

// Revela o conteúdo com fade-up quando entra no viewport.
function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          obs.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <Box
      ref={ref}
      sx={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(32px)',
        transition: `opacity .7s ease ${delay}ms, transform .7s cubic-bezier(.2,.8,.2,1) ${delay}ms`,
      }}
    >
      {children}
    </Box>
  );
}

const FEATURES: Array<{ icon: ReactNode; title: string; desc: string; tag: string }> = [
  {
    icon: <LocalFireDepartmentRounded />,
    tag: 'Descoberta',
    title: 'Produtos em alta',
    desc: 'Ranking diário dos produtos que mais vendem no TikTok Shop, com receita estimada, comissão e velocidade de crescimento.',
  },
  {
    icon: <OndemandVideoRounded />,
    tag: 'Conteúdo',
    title: 'Vídeos que vendem',
    desc: 'Descubra os vídeos com maior conversão por nicho e entenda os ganchos, formatos e CTAs que estão funcionando agora.',
  },
  {
    icon: <GroupsRounded />,
    tag: 'Parcerias',
    title: 'Radar de criadores',
    desc: 'Encontre criadores por nicho, engajamento e GMV para fechar parcerias antes da concorrência.',
  },
  {
    icon: <AutoFixHighRounded />,
    tag: 'IA',
    title: 'Estúdio IA',
    desc: 'Gere roteiros de vídeo prontos para gravar a partir de qualquer produto — gancho, corpo e CTA em segundos.',
  },
  {
    icon: <StyleRounded />,
    tag: 'Biblioteca',
    title: 'Cofre de prompts',
    desc: 'Biblioteca de prompts testados para criativos, legendas e respostas de comentários que aumentam a conversão.',
  },
  {
    icon: <InsightsRounded />,
    tag: 'Sinais',
    title: 'Tendências antecipadas',
    desc: 'Sinais de tendência antes do pico: monitore categorias, hashtags e sons em ascensão para chegar primeiro.',
  },
];

const STEPS = [
  { n: '01', title: 'Descubra', desc: 'Filtre os produtos em alta por nicho, comissão e concorrência.' },
  { n: '02', title: 'Analise', desc: 'Veja os vídeos e criadores que já provaram que o produto vende.' },
  { n: '03', title: 'Crie', desc: 'Gere o roteiro com IA e publique antes do mercado saturar.' },
];

const NICHES = [
  'Beleza', 'Casa inteligente', 'Fitness', 'Gadgets', 'Cozinha', 'Moda', 'Pet', 'Maquiagem',
  'Organização', 'Skincare', 'Eletrônicos', 'Infantil',
];

const TICKER_WORDS = ['viral', 'lucrativo', 'em alta', 'tendência'];

function MockRow({ name, growth, revenue, w, delay }: { name: string; growth: string; revenue: string; w: number; delay: number }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 1.1, borderBottom: `1px solid ${line}` }}>
      <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, background: `linear-gradient(135deg, ${red}33, ${cyan}33)` }} />
      <Box flex={1} minWidth={0}>
        <Typography fontSize={13} fontWeight={700} color="#fff" noWrap>{name}</Typography>
        <Box
          sx={{
            mt: 0.6, height: 4, borderRadius: 2, width: `${w}%`,
            background: `linear-gradient(90deg, ${red}, ${cyan})`,
            animation: `lpBar 1.2s cubic-bezier(.2,.8,.2,1) ${delay}ms both`,
          }}
        />
      </Box>
      <Chip size="small" label={growth} sx={{ bgcolor: 'rgba(37,244,238,0.12)', color: cyan, fontWeight: 700, height: 22 }} />
      <Typography fontSize={13} fontWeight={700} color="#fff" sx={{ width: 72, textAlign: 'right' }}>{revenue}</Typography>
    </Stack>
  );
}

function FloatingBadge({
  children,
  sx,
  duration = 5,
  alt = false,
}: {
  children: ReactNode;
  sx: object;
  duration?: number;
  alt?: boolean;
}) {
  return (
    <Box
      sx={{
        ...glass,
        position: 'absolute',
        borderRadius: 3,
        px: 1.75,
        py: 1,
        display: { xs: 'none', lg: 'flex' },
        alignItems: 'center',
        gap: 1,
        boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
        animation: `${alt ? 'lpFloatAlt' : 'lpFloat'} ${duration}s ease-in-out infinite`,
        zIndex: 2,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <Box sx={{ bgcolor: ink, color: '#fff', minHeight: '100vh', overflowX: 'hidden', position: 'relative' }}>
      {landingKeyframes}

      {/* Fundo: grade de pontos + blobs animados */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.9), transparent 55%)',
        }}
      />
      <Box aria-hidden sx={{ position: 'absolute', top: -120, left: -80, width: 480, height: 480, borderRadius: '50%', filter: 'blur(120px)', background: `${red}30`, animation: 'lpBlob 16s ease-in-out infinite', pointerEvents: 'none' }} />
      <Box aria-hidden sx={{ position: 'absolute', top: 120, right: -140, width: 420, height: 420, borderRadius: '50%', filter: 'blur(120px)', background: `${cyan}24`, animation: 'lpBlob 20s ease-in-out infinite reverse', pointerEvents: 'none' }} />

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
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Box
                component="img"
                src="/icon-192.png"
                alt="PikPok"
                sx={{ width: 34, height: 34, borderRadius: 2, boxShadow: `0 4px 14px ${red}44` }}
              />
              <Typography fontWeight={800} fontSize={20} letterSpacing="-0.02em">
                Pik<Box component="span" sx={{ color: red }}>Pok</Box>
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button
                component={RouterLink}
                to="/login"
                startIcon={<LoginRounded />}
                sx={{ color: textDim, transition: 'color .2s ease', '&:hover': { color: '#fff' }, '&:active': { transform: 'scale(0.97)' } }}
              >
                Entrar
              </Button>
              <Button
                component={RouterLink}
                to="/login"
                variant="contained"
                endIcon={<ArrowForwardRounded sx={{ transition: 'transform .2s ease' }} />}
                sx={{
                  bgcolor: red, px: 2.5, transition: 'all .2s ease',
                  '&:hover': { bgcolor: '#e0264c', transform: 'translateY(-1px)', '& .MuiButton-endIcon svg': { transform: 'translateX(3px)' } },
                  '&:active': { transform: 'scale(0.97)' },
                }}
              >
                Começar grátis
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* Hero */}
      <Box sx={{ position: 'relative' }}>
        <Container maxWidth="lg" sx={{ pt: { xs: 8, md: 12 }, pb: { xs: 8, md: 10 } }}>
          <Grid container spacing={6} alignItems="center">
            <Grid item xs={12} md={6}>
              <Box sx={{ animation: 'lpFadeUp .7s ease both' }}>
                <Chip
                  icon={<BoltRounded sx={{ fontSize: 16, color: `${cyan} !important` }} />}
                  label="Inteligência de vendas para o TikTok Shop"
                  sx={{ ...glass, color: textDim, mb: 3, px: 0.5, fontWeight: 600 }}
                />
              </Box>
              <Typography
                component="h1"
                sx={{
                  fontSize: { xs: 40, md: 56 }, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.03em',
                  animation: 'lpFadeUp .7s ease .1s both',
                }}
              >
                Encontre o próximo produto{' '}
                {/* Ticker vertical de palavras */}
                <Box component="span" sx={{ display: 'inline-block', overflow: 'hidden', height: '1.12em', verticalAlign: 'bottom' }}>
                  <Box component="span" sx={{ display: 'block', animation: 'lpTicker 9s cubic-bezier(.7,0,.3,1) infinite' }}>
                    {TICKER_WORDS.map((w) => (
                      <Box key={w} component="span" sx={{ ...gradientText, display: 'block', height: '1.12em' }}>
                        {w}
                      </Box>
                    ))}
                  </Box>
                </Box>
                <br />
                antes de todo mundo
              </Typography>
              <Typography sx={{ color: textDim, fontSize: 18, mt: 3, maxWidth: 480, lineHeight: 1.6, animation: 'lpFadeUp .7s ease .2s both' }}>
                O PikPok monitora produtos, vídeos e criadores do TikTok Shop em tempo real e transforma
                dados em roteiros prontos para vender.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mt={4} sx={{ animation: 'lpFadeUp .7s ease .3s both' }}>
                <Button
                  component={RouterLink}
                  to="/login"
                  size="large"
                  variant="contained"
                  startIcon={<RocketLaunchRounded />}
                  endIcon={<ArrowForwardRounded sx={{ transition: 'transform .2s ease' }} />}
                  sx={{
                    bgcolor: red, px: 4, py: 1.5, fontSize: 16,
                    boxShadow: `0 8px 30px ${red}66`,
                    position: 'relative', overflow: 'hidden',
                    transition: 'transform .2s ease, box-shadow .2s ease',
                    '&:hover': {
                      bgcolor: '#e0264c', transform: 'translateY(-2px)', boxShadow: `0 14px 40px ${red}80`,
                      '& .MuiButton-endIcon svg': { transform: 'translateX(4px)' },
                    },
                    '&:active': { transform: 'translateY(0) scale(0.97)' },
                    '&::after': {
                      content: '""', position: 'absolute', top: 0, bottom: 0, width: '40%',
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                      animation: 'lpShine 3.2s ease-in-out infinite',
                    },
                  }}
                >
                  Começar grátis
                </Button>
                <Button
                  component={RouterLink}
                  to="/login"
                  size="large"
                  startIcon={<PlayArrowRounded />}
                  sx={{
                    ...glass, color: '#fff', px: 3.5, py: 1.5, fontSize: 16,
                    transition: 'border-color .2s ease, transform .2s ease',
                    '&:hover': { borderColor: `${cyan}66`, transform: 'translateY(-2px)' },
                    '&:active': { transform: 'scale(0.97)' },
                  }}
                >
                  Ver demonstração
                </Button>
              </Stack>
              <Stack direction="row" spacing={{ xs: 3, md: 5 }} mt={6} sx={{ animation: 'lpFadeUp .7s ease .4s both' }}>
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

            {/* Mock do dashboard com badges flutuantes */}
            <Grid item xs={12} md={6}>
              <Box sx={{ position: 'relative', animation: 'lpFadeUp .8s ease .25s both' }}>
                <FloatingBadge sx={{ top: -26, right: 24 }} duration={5}>
                  <RocketLaunchRounded sx={{ fontSize: 18, color: cyan }} />
                  <Box>
                    <Typography fontSize={12} fontWeight={800} lineHeight={1.2}>Novo viral detectado</Typography>
                    <Typography fontSize={11} color={textDim} lineHeight={1.2}>há 2 minutos</Typography>
                  </Box>
                </FloatingBadge>
                <FloatingBadge sx={{ bottom: -22, left: -28 }} duration={6} alt>
                  <TrendingUpRounded sx={{ fontSize: 18, color: red }} />
                  <Box>
                    <Typography fontSize={12} fontWeight={800} lineHeight={1.2}>+312% em 24h</Typography>
                    <Typography fontSize={11} color={textDim} lineHeight={1.2}>mini ring light</Typography>
                  </Box>
                </FloatingBadge>
                <FloatingBadge sx={{ top: '42%', right: -34 }} duration={7}>
                  <AutoFixHighRounded sx={{ fontSize: 18, color: cyan }} />
                  <Typography fontSize={12} fontWeight={800}>Roteiro gerado ✓</Typography>
                </FloatingBadge>

                <Box
                  sx={{
                    ...glass, p: 3, boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
                    transition: 'transform .3s ease',
                    '&:hover': { transform: 'perspective(900px) rotateX(1.5deg) rotateY(-2deg) translateY(-4px)' },
                  }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TrendingUpRounded sx={{ color: red }} />
                      <Typography fontWeight={700} fontSize={14}>Produtos em alta · hoje</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.8} alignItems="center">
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: red, animation: 'lpPulse 1.8s ease infinite' }} />
                      <Typography fontSize={12} fontWeight={700} color={red}>ao vivo</Typography>
                    </Stack>
                  </Stack>
                  <MockRow name="Mini ring light recarregável" growth="+312%" revenue="R$ 84k" w={92} delay={400} />
                  <MockRow name="Escova alisadora 3 em 1" growth="+248%" revenue="R$ 61k" w={78} delay={550} />
                  <MockRow name="Organizador de maquiagem" growth="+197%" revenue="R$ 47k" w={64} delay={700} />
                  <MockRow name="Garrafa térmica smart" growth="+154%" revenue="R$ 39k" w={51} delay={850} />
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
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Marquee de nichos */}
      <Box sx={{ borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}`, py: 2.25, overflow: 'hidden', position: 'relative', bgcolor: inkSoft }}>
        <Box
          sx={{
            display: 'flex', gap: 5, width: 'max-content',
            animation: 'lpMarquee 30s linear infinite',
            '&:hover': { animationPlayState: 'paused' },
          }}
        >
          {[...NICHES, ...NICHES].map((n, i) => (
            <Stack key={`${n}-${i}`} direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.55 }}>
              <LocalFireDepartmentRounded sx={{ fontSize: 15, color: red }} />
              <Typography fontSize={14} fontWeight={700} whiteSpace="nowrap" letterSpacing="0.04em">
                {n}
              </Typography>
            </Stack>
          ))}
        </Box>
        {/* fades laterais */}
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(90deg, ${inkSoft}, transparent 12%, transparent 88%, ${inkSoft})` }} />
      </Box>

      {/* Features */}
      <Container maxWidth="lg" sx={{ py: { xs: 8, md: 12 } }}>
        <Reveal>
          <Box textAlign="center" mb={7}>
            <Typography sx={{ color: cyan, fontWeight: 700, letterSpacing: '0.14em', fontSize: 13 }}>
              TUDO EM UM SÓ LUGAR
            </Typography>
            <Typography sx={{ fontSize: { xs: 30, md: 40 }, fontWeight: 800, letterSpacing: '-0.02em', mt: 1 }}>
              Da descoberta ao roteiro pronto
            </Typography>
          </Box>
        </Reveal>
        <Grid container spacing={3}>
          {FEATURES.map((f, i) => (
            <Grid item xs={12} sm={6} md={4} key={f.title}>
              <Reveal delay={(i % 3) * 120}>
                <Box
                  sx={{
                    ...glass, p: 3.5, height: '100%', position: 'relative', overflow: 'hidden',
                    transition: 'transform .25s ease, border-color .25s ease, box-shadow .25s ease',
                    '&:hover': {
                      transform: 'translateY(-6px)',
                      borderColor: `${red}55`,
                      boxShadow: `0 20px 50px rgba(0,0,0,0.45), 0 0 0 1px ${red}22`,
                      '& .lp-feature-glow': { opacity: 1 },
                      '& .lp-feature-icon': { transform: 'scale(1.08) rotate(-4deg)' },
                    },
                  }}
                >
                  <Box
                    className="lp-feature-glow"
                    aria-hidden
                    sx={{
                      position: 'absolute', top: -60, right: -60, width: 160, height: 160, borderRadius: '50%',
                      background: `radial-gradient(circle, ${red}2e, transparent 70%)`,
                      opacity: 0, transition: 'opacity .3s ease', pointerEvents: 'none',
                    }}
                  />
                  <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2.5}>
                    <Box
                      className="lp-feature-icon"
                      sx={{
                        width: 44, height: 44, borderRadius: 3, display: 'grid', placeItems: 'center',
                        background: `linear-gradient(135deg, ${red}2e, ${cyan}2e)`, color: '#fff',
                        transition: 'transform .25s ease',
                      }}
                    >
                      {f.icon}
                    </Box>
                    <Chip size="small" label={f.tag} sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: textDim, fontWeight: 700, height: 22, fontSize: 11 }} />
                  </Stack>
                  <Typography fontWeight={700} fontSize={17} mb={1}>{f.title}</Typography>
                  <Typography fontSize={14.5} color={textDim} lineHeight={1.65}>{f.desc}</Typography>
                </Box>
              </Reveal>
            </Grid>
          ))}
        </Grid>
      </Container>

      {/* Como funciona */}
      <Box sx={{ bgcolor: inkSoft, borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}`, position: 'relative', overflow: 'hidden' }}>
        <Box aria-hidden sx={{ position: 'absolute', bottom: -160, left: '40%', width: 420, height: 420, borderRadius: '50%', filter: 'blur(130px)', background: `${red}1c`, pointerEvents: 'none' }} />
        <Container maxWidth="lg" sx={{ py: { xs: 8, md: 10 } }}>
          <Grid container spacing={4}>
            {STEPS.map((s, i) => (
              <Grid item xs={12} md={4} key={s.n}>
                <Reveal delay={i * 150}>
                  <Box
                    sx={{
                      position: 'relative', pl: 3,
                      '&::before': {
                        content: '""', position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2,
                        background: `linear-gradient(180deg, ${red}, ${cyan})`,
                      },
                    }}
                  >
                    <Typography sx={{ ...gradientText, fontSize: 40, fontWeight: 800 }}>{s.n}</Typography>
                    <Typography fontWeight={700} fontSize={19} mt={1}>{s.title}</Typography>
                    <Typography color={textDim} fontSize={15} mt={1} lineHeight={1.6}>{s.desc}</Typography>
                  </Box>
                </Reveal>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* CTA final */}
      <Container maxWidth="md" sx={{ py: { xs: 10, md: 14 }, textAlign: 'center', position: 'relative' }}>
        <Reveal>
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
            startIcon={<RocketLaunchRounded />}
            endIcon={<ArrowForwardRounded sx={{ transition: 'transform .2s ease' }} />}
            sx={{
              mt: 4, bgcolor: red, px: 5, py: 1.6, fontSize: 16,
              boxShadow: `0 8px 30px ${red}66`, position: 'relative', overflow: 'hidden',
              transition: 'transform .2s ease, box-shadow .2s ease',
              '&:hover': {
                bgcolor: '#e0264c', transform: 'translateY(-2px)', boxShadow: `0 16px 44px ${red}80`,
                '& .MuiButton-endIcon svg': { transform: 'translateX(4px)' },
              },
              '&:active': { transform: 'translateY(0) scale(0.97)' },
              '&::after': {
                content: '""', position: 'absolute', top: 0, bottom: 0, width: '40%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                animation: 'lpShine 3.2s ease-in-out infinite',
              },
            }}
          >
            Criar conta grátis
          </Button>
        </Reveal>
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
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Box component="img" src="/icon-192.png" alt="PikPok" sx={{ width: 28, height: 28, borderRadius: 1.5 }} />
              <Typography fontWeight={800}>
                Pik<Box component="span" sx={{ color: red }}>Pok</Box>
              </Typography>
            </Stack>
            <Typography fontSize={13} color={textDim}>
              © {new Date().getFullYear()} PikPok — inteligência de produtos para o TikTok Shop
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
