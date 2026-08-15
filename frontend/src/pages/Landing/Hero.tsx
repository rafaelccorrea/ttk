import {
  ArrowForwardRounded,
  AutoFixHighRounded,
  BoltRounded,
  PlayArrowRounded,
  RocketLaunchRounded,
  TrendingUpRounded,
  VerifiedRounded,
} from '@mui/icons-material';
import { Box, Button, Chip, Container, Grid, Stack, Typography } from '@mui/material';
import { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { TICKER_WORDS } from './data';
import { cyan, glass, gradientText, line, page, red, textDim, textFaint, useCountUp } from './theme';

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

function HeroStat({ to, suffix, label, decimals = 0 }: { to: number; suffix: string; label: string; decimals?: number }) {
  const { ref, value } = useCountUp(to);
  return (
    <Box>
      <Typography ref={ref} component="span" sx={{ ...gradientText, fontSize: 28, fontWeight: 800, display: 'block' }}>
        {value.toFixed(decimals).replace('.', ',')}
        {suffix}
      </Typography>
      <Typography fontSize={13} color={textDim}>{label}</Typography>
    </Box>
  );
}

export function Hero() {
  return (
    <Box sx={{ position: 'relative' }}>
      <Container maxWidth={false} sx={{ ...page, pt: { xs: 7, md: 11 }, pb: { xs: 8, md: 10 } }}>
        <Grid container spacing={{ xs: 6, lg: 8 }} alignItems="center">
          <Grid item xs={12} md={6} lg={5}>
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
                fontSize: { xs: 40, md: 58 }, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.03em',
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
            <Typography sx={{ color: textDim, fontSize: 18, mt: 3, maxWidth: 540, lineHeight: 1.65, animation: 'lpFadeUp .7s ease .2s both' }}>
              O PikPok monitora produtos, vídeos e criadores do TikTok Shop todos os dias e transforma
              esses dados em roteiros prontos para gravar.
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
                href="#como-funciona"
                size="large"
                startIcon={<PlayArrowRounded />}
                sx={{
                  ...glass, color: '#fff', px: 3.5, py: 1.5, fontSize: 16,
                  transition: 'border-color .2s ease, transform .2s ease',
                  '&:hover': { borderColor: `${cyan}66`, transform: 'translateY(-2px)' },
                  '&:active': { transform: 'scale(0.97)' },
                }}
              >
                Ver como funciona
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center" mt={3} sx={{ animation: 'lpFadeUp .7s ease .35s both' }}>
              <VerifiedRounded sx={{ fontSize: 17, color: cyan }} />
              <Typography fontSize={13.5} color={textFaint}>
                Plano gratuito para sempre · 30 créditos de boas-vindas · sem cartão
              </Typography>
            </Stack>

            <Stack direction="row" spacing={{ xs: 3, md: 5 }} mt={5} sx={{ animation: 'lpFadeUp .7s ease .4s both' }}>
              <HeroStat to={12} suffix="k+" label="produtos monitorados" />
              <HeroStat to={48} suffix="h" label="de antecedência média" />
              <HeroStat to={3} suffix="x" label="mais conversão" />
            </Stack>
          </Grid>

          {/* Mock do dashboard com badges flutuantes */}
          <Grid item xs={12} md={6} lg={7}>
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
  );
}
