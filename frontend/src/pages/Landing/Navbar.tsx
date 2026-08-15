import {
  ArrowForwardRounded,
  CloseRounded,
  LoginRounded,
  MenuRounded,
} from '@mui/icons-material';
import { Box, Button, Container, Drawer, IconButton, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { NAV_LINKS } from './data';
import { glass, line, page, red, textDim } from './theme';

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(window.scrollY > 12);
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const logo = (size = 34) => (
    <Stack direction="row" spacing={1.25} alignItems="center">
      <Box
        component="img"
        src="/icon-192.png"
        alt="PikPok"
        sx={{ width: size, height: size, borderRadius: 2, boxShadow: `0 4px 14px ${red}44` }}
      />
      <Typography fontWeight={800} fontSize={20} letterSpacing="-0.02em">
        Pik<Box component="span" sx={{ color: red }}>Pok</Box>
      </Typography>
    </Stack>
  );

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky', top: 0, zIndex: 20,
        borderBottom: `1px solid ${scrolled ? line : 'transparent'}`,
        bgcolor: scrolled ? 'rgba(8,9,15,0.78)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        transition: 'background-color .3s ease, border-color .3s ease',
      }}
    >
      {/* Barra de progresso de leitura */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute', left: 0, bottom: -1, height: 2, width: `${progress * 100}%`,
          background: `linear-gradient(90deg, ${red}, #25f4ee)`, transition: 'width .1s linear',
        }}
      />
      <Container maxWidth={false} sx={page}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" py={1.5}>
          <Box component={RouterLink} to="/" sx={{ textDecoration: 'none', color: 'inherit' }}>
            {logo()}
          </Box>

          <Stack direction="row" spacing={3} alignItems="center" sx={{ display: { xs: 'none', md: 'flex' } }}>
            {NAV_LINKS.map((l) => (
              <Box
                key={l.href}
                component="a"
                href={l.href}
                sx={{
                  color: textDim, fontSize: 14.5, fontWeight: 600, textDecoration: 'none',
                  position: 'relative', transition: 'color .2s ease',
                  '&::after': {
                    content: '""', position: 'absolute', left: 0, bottom: -6, height: 2, width: 0,
                    background: `linear-gradient(90deg, ${red}, #25f4ee)`, transition: 'width .25s ease',
                  },
                  '&:hover': { color: '#fff', '&::after': { width: '100%' } },
                }}
              >
                {l.label}
              </Box>
            ))}
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button
              component={RouterLink}
              to="/login"
              startIcon={<LoginRounded />}
              sx={{
                display: { xs: 'none', sm: 'inline-flex' },
                color: textDim, transition: 'color .2s ease',
                '&:hover': { color: '#fff' }, '&:active': { transform: 'scale(0.97)' },
              }}
            >
              Entrar
            </Button>
            <Button
              component={RouterLink}
              to="/login"
              variant="contained"
              endIcon={<ArrowForwardRounded sx={{ transition: 'transform .2s ease' }} />}
              sx={{
                bgcolor: red, px: 2.5, transition: 'all .2s ease', whiteSpace: 'nowrap',
                '&:hover': { bgcolor: '#e0264c', transform: 'translateY(-1px)', '& .MuiButton-endIcon svg': { transform: 'translateX(3px)' } },
                '&:active': { transform: 'scale(0.97)' },
              }}
            >
              Começar grátis
            </Button>
            <IconButton
              aria-label="Abrir menu"
              onClick={() => setOpen(true)}
              sx={{ display: { xs: 'inline-flex', md: 'none' }, color: '#fff' }}
            >
              <MenuRounded />
            </IconButton>
          </Stack>
        </Stack>
      </Container>

      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{ sx: { bgcolor: '#0e1018', color: '#fff', width: 288, borderLeft: `1px solid ${line}` } }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" px={2.5} py={2}>
          {logo(30)}
          <IconButton aria-label="Fechar menu" onClick={() => setOpen(false)} sx={{ color: '#fff' }}>
            <CloseRounded />
          </IconButton>
        </Stack>
        <Stack px={2.5} pt={1} spacing={0.5}>
          {NAV_LINKS.map((l) => (
            <Box
              key={l.href}
              component="a"
              href={l.href}
              onClick={() => setOpen(false)}
              sx={{
                py: 1.4, color: textDim, fontSize: 16, fontWeight: 600, textDecoration: 'none',
                borderBottom: `1px solid ${line}`, '&:hover': { color: '#fff' },
              }}
            >
              {l.label}
            </Box>
          ))}
          <Button
            component={RouterLink}
            to="/login"
            onClick={() => setOpen(false)}
            variant="contained"
            sx={{ mt: 3, bgcolor: red, py: 1.2, '&:hover': { bgcolor: '#e0264c' } }}
          >
            Começar grátis
          </Button>
          <Button
            component={RouterLink}
            to="/login"
            onClick={() => setOpen(false)}
            sx={{ ...glass, mt: 1.5, color: '#fff', py: 1.2 }}
          >
            Já tenho conta
          </Button>
        </Stack>
      </Drawer>
    </Box>
  );
}
