import { Box, keyframes } from '@mui/material';
import { ReactNode, useEffect, useRef, useState } from 'react';

import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { resolveApiUrl } from '@/services/api';

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
  /**
   * `lazy` só para listas realmente longas, e mesmo assim com cautela — ver o
   * comentário sobre o padrão `eager` abaixo.
   */
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
  /**
   * `eager` por padrão, e isso é intencional.
   *
   * Com `loading="lazy"` as capas simplesmente não apareciam. Os cards são
   * renderizados ANTES dos dados chegarem, com altura zero; o navegador avalia
   * a proximidade da viewport nesse instante, decide que a imagem está longe e
   * a adia. A reavaliação nativa só acontece quando a página rola — então quem
   * abria a tela e não rolava ficava olhando para um buraco, e quem rolava
   * via tudo aparecer. Era exatamente o "às vezes não aparece".
   *
   * Medido: `<img loading="lazy">` com retângulo de 249×444 a 282px do topo
   * ficava com `complete: false` indefinidamente; a MESMA URL num `new Image()`
   * carregava na hora. Não é a rede nem o arquivo — é a heurística.
   *
   * As telas já paginam, então o que está montado cabe em algumas dezenas de
   * imagens de ~30KB. Adiar isso economiza pouco e custa a tela inteira.
   */
  loading = 'eager',
}: SmartImageProps) {
  /**
   * O backend devolve caminho RELATIVO para o que está espelhado no S3
   * (`/api/v1/media/...`). Em produção o front roda em outro domínio, então
   * esse caminho aponta para lugar nenhum e a foto simplesmente não aparecia —
   * era a "foto do produto que às vezes some". Resolver aqui conserta todos os
   * pontos de uma vez; para URL absoluta o `resolveApiUrl` é no-op.
   */
  const url = src ? resolveApiUrl(src) : null;

  // Sem src não há o que esperar: já começa no estado final.
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    url ? 'loading' : 'error',
  );

  const imgRef = useRef<HTMLImageElement | null>(null);

  // Trocar de foto no mesmo slot (galeria, storyboard) reaproveita o
  // componente. Sem religar o estado, a nova imagem herdaria o `loaded` da
  // anterior e apareceria sem shimmer — ou, pior, herdaria o `error` e nunca
  // apareceria.
  useEffect(() => {
    if (!url) {
      setStatus('error');
      return;
    }
    /**
     * Corrida do cache: uma imagem já em cache termina de carregar ANTES de o
     * React pendurar o `onLoad`, então o evento nunca chega e o estado ficaria
     * preso em `loading` — que é opacidade zero, ou seja, um buraco no lugar da
     * foto mesmo com o arquivo baixado e decodificado.
     *
     * Por isso o estado não pode depender só do evento: aqui perguntamos ao
     * elemento se ele já está pronto. `complete` sozinho não basta — ele também
     * é `true` quando a imagem falhou —, daí o `naturalWidth`.
     */
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) {
      setStatus('loaded');
      return;
    }
    setStatus('loading');
  }, [url]);

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
          {/* Nunca deixar o buraco: sem `fallback` o slot ficava branco e
              parecia que o produto tinha sumido. */}
          {fallback ?? <ImagePlaceholder loading={false} />}
        </Box>
      )}

      {url && status !== 'error' && (
        <Box
          component="img"
          // Remonta ao trocar de foto: sem isso o navegador mantém o quadro
          // antigo na tela até a nova terminar de baixar.
          key={url}
          ref={imgRef}
          src={url}
          alt={alt}
          loading={loading}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          sx={{
            width: '100%',
            height: '100%',
            objectFit,
            display: 'block',
            /**
             * A imagem NÃO é escondida enquanto carrega, e isso é deliberado.
             *
             * A versão anterior usava `opacity: status === 'loaded' ? 1 : 0`,
             * ou seja, os pixels só apareciam se um evento de JavaScript
             * tivesse chegado. Quando a imagem vem do cache ela termina antes
             * de o React pendurar o `onLoad`, o evento nunca dispara, e o
             * resultado é uma foto baixada, decodificada e invisível — medido
             * em produção local: `complete: true`, `naturalWidth: 480`,
             * `opacity: 0`.
             *
             * Fazer a visibilidade depender de um evento cria essa classe
             * inteira de bug. Aqui o navegador é a fonte da verdade: até ter
             * pixels o `<img>` é transparente e o shimmer aparece POR BAIXO;
             * quando os pixels chegam, ele cobre o shimmer sozinho. Nenhum
             * estado de JavaScript pode deixar a foto presa invisível.
             */
            position: 'relative',
          }}
        />
      )}
    </Box>
  );
}
