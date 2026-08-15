import { useEffect, useRef } from 'react';

interface Options {
  /** Há mais páginas para buscar. */
  hasMore: boolean;
  /** Uma requisição já está em andamento. */
  loading: boolean;
  /** Chamado quando a sentinela entra na viewport. */
  onLoadMore: () => void;
  /** Antecedência do disparo, em pixels antes do fim da lista. */
  rootMargin?: string;
}

/**
 * Scroll infinito por sentinela.
 *
 * Usa `IntersectionObserver` em vez de escutar `scroll`: o navegador avisa só
 * quando o elemento entra em cena, sem rodar callback a cada pixel rolado.
 *
 * A margem de 600px dispara a busca ANTES de o usuário chegar ao fim, então a
 * próxima leva costuma já estar na tela quando ele alcança — o carregamento
 * fica imperceptível.
 *
 * Devolve a ref para pendurar num elemento vazio no fim da lista.
 */
export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
  rootMargin = '600px',
}: Options) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Mantém o callback atual sem recriar o observer a cada render.
  const callbackRef = useRef(onLoadMore);
  callbackRef.current = onLoadMore;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) callbackRef.current();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, rootMargin]);

  return sentinelRef;
}
