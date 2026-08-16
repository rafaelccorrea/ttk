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
import { BrowserFrame, cyanDeep, glass, gradientText, page, red, textDim, textFaint, textMain, useCountUp } from './theme';


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
        boxShadow: '0 16px 40px rgba(11,12,18,0.14)',
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
                icon={<BoltRounded sx={{ fontSize: 16, color: `${cyanDeep} !important` }} />}
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
                Assinar agora
              </Button>
              <Button
                href="#como-funciona"
                size="large"
                startIcon={<PlayArrowRounded />}
                sx={{
                  ...glass, color: textMain, px: 3.5, py: 1.5, fontSize: 16,
                  transition: 'border-color .2s ease, transform .2s ease',
                  '&:hover': { borderColor: `${cyanDeep}66`, transform: 'translateY(-2px)' },
                  '&:active': { transform: 'scale(0.97)' },
                }}
              >
                Ver como funciona
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center" mt={3} sx={{ animation: 'lpFadeUp .7s ease .35s both' }}>
              <VerifiedRounded sx={{ fontSize: 17, color: cyanDeep }} />
              <Typography fontSize={13.5} color={textFaint}>
                Dados reais atualizados todo dia · Cancele quando quiser
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
              <FloatingBadge sx={{ top: -30, right: -18 }} duration={5}>
                <RocketLaunchRounded sx={{ fontSize: 18, color: cyanDeep }} />
                <Box>
                  <Typography fontSize={12} fontWeight={800} lineHeight={1.2}>Novo viral detectado</Typography>
                  <Typography fontSize={11} color={textDim} lineHeight={1.2}>há 2 minutos</Typography>
                </Box>
              </FloatingBadge>
              <FloatingBadge sx={{ bottom: -26, left: -44 }} duration={6} alt>
                <TrendingUpRounded sx={{ fontSize: 18, color: red }} />
                <Box>
                  <Typography fontSize={12} fontWeight={800} lineHeight={1.2}>+312% em 24h</Typography>
                  <Typography fontSize={11} color={textDim} lineHeight={1.2}>mini ring light</Typography>
                </Box>
              </FloatingBadge>
              <FloatingBadge sx={{ top: '58%', right: -52 }} duration={7}>
                <AutoFixHighRounded sx={{ fontSize: 18, color: cyanDeep }} />
                <Typography fontSize={12} fontWeight={800}>Roteiro gerado ✓</Typography>
              </FloatingBadge>

              <Box
                sx={{
                  transition: 'transform .35s ease',
                  '&:hover': { transform: 'perspective(1100px) rotateX(1.5deg) rotateY(-2deg) translateY(-4px)' },
                }}
              >
                <BrowserFrame
                  src="/screens/dashboard.jpg"
                  alt="Dashboard do PikPok com faturamento rastreado e produtos em alta"
                  caption="app.pikpok.com.br/dashboard"
                  priority
                />
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
