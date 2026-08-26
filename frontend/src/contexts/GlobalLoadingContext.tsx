import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { GlobalLoader } from '@/components/ui/GlobalLoader';

interface GlobalLoadingApi {
  /** Mostra a variante leve em tela cheia. Chamadas empilham: hide() por show(). */
  show: () => void;
  hide: () => void;
  visivel: boolean;
}

const Ctx = createContext<GlobalLoadingApi | null>(null);

export function GlobalLoadingProvider({ children }: { children: ReactNode }) {
  const contador = useRef(0);
  const [visivel, setVisivel] = useState(false);

  const show = useCallback(() => {
    contador.current += 1;
    setVisivel(true);
  }, []);
  const hide = useCallback(() => {
    contador.current = Math.max(0, contador.current - 1);
    if (contador.current === 0) setVisivel(false);
  }, []);

  const api = useMemo(() => ({ show, hide, visivel }), [show, hide, visivel]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {visivel && <GlobalLoader variante="leve" />}
    </Ctx.Provider>
  );
}

export function useGlobalLoading(): GlobalLoadingApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGlobalLoading precisa do GlobalLoadingProvider');
  return ctx;
}
