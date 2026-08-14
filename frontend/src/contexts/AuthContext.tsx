import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, TOKEN_STORAGE_KEY } from '@/services/api';
import { supabase } from '@/services/supabase';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  email: string | null;
  /** true quando o projeto Supabase não está configurado (modo demo). */
  isDemoMode: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY),
  );
  const [email, setEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));

  const persist = useCallback((accessToken: string | null, mail: string | null) => {
    if (accessToken) {
      localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    setToken(accessToken);
    setEmail(mail);
  }, []);

  // Mantém o token sincronizado com a sessão do Supabase (refresh automático).
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      persist(
        data.session?.access_token ?? null,
        data.session?.user.email ?? null,
      );
      setIsLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        persist(session?.access_token ?? null, session?.user.email ?? null);
      },
    );
    return () => subscription.subscription.unsubscribe();
  }, [persist]);

  const signIn = useCallback(
    async (mail: string, password: string) => {
      if (supabase) {
        const { error } = await supabase.auth.signInWithPassword({
          email: mail,
          password,
        });
        if (error) throw new Error(error.message);
        return;
      }
      // Modo demo: backend emite um JWT local por e-mail.
      const { data } = await api.post<{ accessToken: string }>(
        '/auth/dev-login',
        { email: mail },
      );
      persist(data.accessToken, mail);
    },
    [persist],
  );

  const signUp = useCallback(
    async (mail: string, password: string) => {
      if (supabase) {
        const { error } = await supabase.auth.signUp({
          email: mail,
          password,
        });
        if (error) throw new Error(error.message);
        return;
      }
      await signIn(mail, password);
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    persist(null, null);
  }, [persist]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(token),
      isLoading,
      email,
      isDemoMode: !supabase,
      signIn,
      signUp,
      signOut,
    }),
    [token, isLoading, email, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  }
  return context;
}
