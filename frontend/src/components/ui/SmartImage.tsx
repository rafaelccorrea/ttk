import { Box, keyframes } from '@mui/material';
import { ReactNode, useState } from 'react';

const shimmer = keyframes`
  0%   { background-position: -180% 0; }
  100% { background-position:  180% 0; }
`;

interface SmartImageProps {
  src?: string | null;
  alt?: string;
  /** Exibido quando não há src ou o carregamento falhou. */
  fallback?: ReactNode;
  objectFit?: 'cover' | 'contain';
  /** Escurece o brilho do shimmer para cards de fundo escuro. */
  tone?: 'light' | 'dark';
  /** `eager` para o que está acima da dobra. */
  loading?: 'lazy' | 'eager';
}

/**
 * Imagem com feedback visual em todos os estados.
 *
 * As capas passam pelo nosso backend (proxy/espelho S3), então a primeira
 * carga demora o suficiente para o usuário ver um buraco no lugar da foto —
 * era isso que dava a impressão de card quebrado. Aqui o espaço nunca fica
 * vazio: shimmer enquanto baixa, `fallback` se não vier, e a foto entra com
 * fade quando chega.
 *
 * Preenche o elemento pai, que precisa ter dimensão própria.
 */
export function SmartImage({
  src,
  alt = '',
  fallback,
  objectFit = 'cover',
  tone = 'light',
  loading = 'lazy',
}: SmartImageProps) {
  // Sem src não há o que esperar: já começa no estado final.
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    src ? 'loading' : 'error',
  );

  const brilho =
    tone === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(22,24,35,0.07)';
  const base = tone === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(22,24,35,0.04)';

  return (
    <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {status === 'loading' && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(90deg, ${base} 25%, ${brilho} 50%, ${base} 75%)`,
            backgroundSize: '250% 100%',
            animation: `${shimmer} 1.4s ease-in-out infinite`,
            '@media (prefers-reduced-motion: reduce)': {
              animation: 'none',
              background: base,
            },
          }}
        />
      )}

      {status === 'error' && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          {fallback}
        </Box>
      )}

      {src && status !== 'error' && (
        <Box
          component="img"
          src={src}
          alt={alt}
          loading={loading}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          sx={{
            width: '100%',
            height: '100%',
            objectFit,
            display: 'block',
            // Só aparece quando terminou: sem isso o navegador mostra a
            // imagem pela metade por cima do shimmer.
            opacity: status === 'loaded' ? 1 : 0,
            transition: 'opacity .35s ease',
          }}
        />
      )}
    </Box>
  );
}
