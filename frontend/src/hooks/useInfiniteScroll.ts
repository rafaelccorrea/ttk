import { useEffect, useRef } from 'react';

interface Options {
  /** Há mais páginas para buscar. */
  hasMore: boolean;
  /** Uma requisição já está em andamento. */
  loading: boolean;
  /** Chamado quando o usuário se aproxima do fim da lista. */
  onLoadMore: () => void;
  /** Antecedência do disparo, em pixels antes do fim da página. */
  offset?: number;
}

/**
 * Scroll infinito por proximidade do fim da página.
 *
 * Usa o evento `scroll` com throttle por `requestAnimationFrame` — no máximo
 * uma verificação por quadro, então o custo é desprezível.
 *
 * Por que não `IntersectionObserver`: neste layout ele não dispara de forma
 * confiável para a sentinela, mesmo com o elemento comprovadamente dentro da
 * viewport (verificado no navegador). A conta de scroll é previsível e não
 * depende de como os contêineres estão empilhados.
 *
 * O disparo acontece `offset` pixels ANTES do fim, então a próxima leva
 * costuma já estar na tela quando o usuário chega lá.
 */
export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
  offset = 700,
}: Options) {
  // Mantém o callback atual sem reinstalar o listener a cada render.
  const callbackRef = useRef(onLoadMore);
  callbackRef.current = onLoadMore;

  useEffect(() => {
    if (!hasMore || loading) return;

    let frame = 0;
    const check = () => {
      frame = 0;
      const doc = document.documentElement;
      const chegouPerto =
        window.scrollY + window.innerHeight >= doc.scrollHeight - offset;
      if (chegouPerto) callbackRef.current();
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(check);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Confere já na montagem: a primeira leva pode não encher a tela, e sem
    // isso o usuário ficaria sem nada para rolar.
    check();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [hasMore, loading, offset]);
}
