import { Box, keyframes } from '@mui/material';

const pulse = keyframes`
  0%, 100% { opacity: 0.85; transform: scale(1); }
  50%      { opacity: 0.45; transform: scale(0.94); }
`;

interface ImagePlaceholderProps {
  /** `true` enquanto a imagem carrega; `false` quando não existe imagem. */
  loading?: boolean;
}

/**
 * Marca d'água da PikPok exibida no lugar da foto.
 *
 * Duas situações caem aqui:
 *  - a imagem ainda está baixando (as capas passam pelo nosso backend, então
 *    a primeira carga leva alguns instantes);
 *  - o item não tem foto alguma.
 *
 * Substitui o retângulo cinza do Skeleton, que dava a impressão de card
 * quebrado. Com a logo, fica claro que é conteúdo do PikPok carregando.
 */
export function ImagePlaceholder({ loading = true }: ImagePlaceholderProps) {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        // Fundo escuro no tom dos cards, com um leve brilho de marca ao centro.
        background:
          'radial-gradient(circle at 50% 45%, rgba(254,44,85,0.16), rgba(18,19,27,0.96) 62%)',
      }}
    >
      <Box
        component="img"
        src="/icon-192.png"
        alt=""
        sx={{
          width: '34%',
          maxWidth: 72,
          minWidth: 34,
          borderRadius: '24%',
          opacity: loading ? 1 : 0.35,
          filter: loading ? 'none' : 'grayscale(1)',
          animation: loading ? `${pulse} 1.5s ease-in-out infinite` : 'none',
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      />
    </Box>
  );
}
