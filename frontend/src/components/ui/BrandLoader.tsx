import { Box, keyframes, Typography } from '@mui/material';

const shimmer = keyframes`
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
`;

const slide = keyframes`
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.85; transform: scale(0.985); }
`;

interface BrandLoaderProps {
  /** Cobre a tela inteira (boot/rotas). Sem ela, centraliza na seção. */
  fullScreen?: boolean;
  /** Texto opcional abaixo da logo (ex.: "Carregando produtos..."). */
  label?: string;
  /** Altura mínima no modo seção. */
  minHeight?: number | string;
}

// Loading padrão do app: logo PikPok com brilho animado + barra gradiente.
export function BrandLoader({
  fullScreen = false,
  label,
  minHeight = 280,
}: BrandLoaderProps) {
  return (
    <Box
      role="status"
      aria-label={label ?? 'Carregando'}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        ...(fullScreen
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: (theme) => theme.zIndex.modal + 1,
              bgcolor: 'background.default',
            }
          : { minHeight, width: '100%' }),
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: fullScreen ? 72 : 56,
          height: fullScreen ? 72 : 56,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {/* Anel de brilho girando atrás da logo */}
        <Box
          sx={{
            position: 'absolute',
            inset: -6,
            borderRadius: '26%',
            background: 'conic-gradient(from 0deg, #fe2c55, #25f4ee, transparent 65%, #fe2c55)',
            filter: 'blur(8px)',
            opacity: 0.55,
            animation: 'pikpok-spin 1.6s linear infinite',
            '@keyframes pikpok-spin': {
              to: { transform: 'rotate(360deg)' },
            },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
        <Box
          component="img"
          src="/icon-192.png"
          alt="PikPok"
          sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: '24%',
            boxShadow: '0 8px 24px rgba(254,44,85,0.35)',
            animation: `${pulse} 1.6s ease-in-out infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      </Box>

      <Typography
        sx={{
          fontSize: fullScreen ? 30 : 24,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          background:
            'linear-gradient(90deg, #161823 20%, #fe2c55 40%, #25f4ee 55%, #161823 75%)',
          backgroundSize: '200% auto',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          animation: `${shimmer} 2.2s linear infinite, ${pulse} 2.2s ease-in-out infinite`,
          '@media (prefers-reduced-motion: reduce)': {
            animation: 'none',
            WebkitTextFillColor: 'unset',
            background: 'none',
            color: 'text.primary',
          },
        }}
      >
        Pik
        <Box component="span" sx={{ WebkitTextFillColor: '#fe2c55' }}>
          Pok
        </Box>
      </Typography>

      <Box
        sx={{
          width: fullScreen ? 180 : 140,
          height: 4,
          borderRadius: 99,
          overflow: 'hidden',
          bgcolor: 'rgba(22,24,35,0.08)',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '45%',
            borderRadius: 99,
            background: 'linear-gradient(90deg, #fe2c55, #25f4ee)',
            animation: `${slide} 1.1s ease-in-out infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none', width: '100%' },
          }}
        />
      </Box>

      {label && (
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      )}
    </Box>
  );
}
