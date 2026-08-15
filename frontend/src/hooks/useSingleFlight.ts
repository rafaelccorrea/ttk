import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Envolve uma ação assíncrona que custa crédito/token do usuário (geração de
 * IA, transcrição) para que ela nunca rode duas vezes em paralelo.
 *
 * Por que não basta `disabled={loading}`: `setLoading(true)` só desabilita o
 * botão no próximo render. Entre o primeiro clique e esse render cabe um
 * segundo clique — e é exatamente isso que acontece num duplo-clique, num
 * mouse com contato sujo, ou quando a pessoa clica de novo porque "não
 * respondeu". A trava aqui é um ref: muda no mesmo tick, antes de qualquer
 * render, então o segundo disparo não passa.
 *
 * O `disabled` continua valendo — ele é o feedback visual. Este hook é a
 * garantia.
 */
export function useSingleFlight<Args extends unknown[], R>(
  action: (...args: Args) => Promise<R>,
) {
  const running = useRef(false);
  const mounted = useRef(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // Impede o setState depois que a pessoa saiu da página.
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setLoading(true);
      try {
        return await action(...args);
      } finally {
        running.current = false;
        if (mounted.current) setLoading(false);
      }
    },
    [action],
  );

  return { run, loading };
}
