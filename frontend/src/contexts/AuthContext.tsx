import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { api, TOKEN_STORAGE_KEY } from '@/services/api';
import { authService, RegisterResult } from '@/services/auth.service';
import { clearReferral, getReferral } from '@/utils/referral';

const EMAIL_STORAGE_KEY = 'pikpok.email';

export interface SignUpResult {
  /** true quando o cadastro exige confirmação de e-mail antes do login. */
  needsConfirmation: boolean;
  message: string;
  /** URL de preview do e-mail (apenas dev, sem SMTP real configurado). */
  previewUrl?: string;
  /** Soft launch: entrou na fila e o e-mail de confirmação vem depois. */
  waitlisted?: boolean;
  position?: number;
  total?: number;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  email: string | null;
  /** Mantido por compatibilidade — auth agora é sempre do backend. */
  isDemoMode: boolean;
  signIn(email: string, password: string): Promise<void>;
  /**
   * Login/cadastro com o credential do Google. Retorna o resultado de fila
   * quando o soft launch segura a conta nova; senão autentica direto.
   */
  signInWithGoogle(credential: string): Promise<SignUpResult | null>;
  signUp(email: string, password: string): Promise<SignUpResult>;
  /** Autentica com um token já emitido (ex.: após confirmar o e-mail). */
  acceptSession(accessToken: string, email: string): void;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY),
  );
  const [email, setEmail] = useState<string | null>(() =>
    localStorage.getItem(EMAIL_STORAGE_KEY),
  );

  const persist = useCallback(
    (accessToken: string | null, mail: string | null) => {
      if (accessToken) {
        localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
        if (mail) localStorage.setItem(EMAIL_STORAGE_KEY, mail);
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(EMAIL_STORAGE_KEY);
      }
      setToken(accessToken);
      setEmail(mail);
    },
    [],
  );

  const signIn = useCallback(
    async (mail: string, password: string) => {
      const { accessToken, user } = await authService.login(mail, password);
      persist(accessToken, user.email);
    },
    [persist],
  );

  const signInWithGoogle = useCallback(
    async (credential: string): Promise<SignUpResult | null> => {
      // O ref segue junto como no cadastro por senha: se a conta nascer
      // agora, é o único momento de gravar quem indicou.
      const result = await authService.googleLogin(credential, getReferral());
      clearReferral();
      if (result.waitlisted) {
        return {
          needsConfirmation: false,
          message: result.message ?? 'Você entrou na lista de espera!',
          waitlisted: true,
          position: result.position,
          total: result.total,
        };
      }
      if (result.accessToken && result.user) {
        persist(result.accessToken, result.user.email);
      }
      return null;
    },
    [persist],
  );

  const signUp = useCallback(
    async (mail: string, password: string): Promise<SignUpResult> => {
      // O ref foi guardado quando a pessoa chegou pelo link de indicação; é
      // aqui, no único momento em que a conta nasce, que ele vira vínculo.
      const result: RegisterResult = await authService.register(
        mail,
        password,
        getReferral(),
      );
      // Vínculo gravado (ou ref inválido, que o backend ignorou): o valor não
      // serve mais e ficaria colado numa próxima conta criada no mesmo navegador.
      clearReferral();
      return {
        needsConfirmation: true,
        message: result.message,
        previewUrl: result.previewUrl,
        waitlisted: result.waitlisted,
        position: result.position,
        total: result.total,
      };
    },
    [],
  );

  const acceptSession = useCallback(
    (accessToken: string, mail: string) => {
      persist(accessToken, mail);
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    persist(null, null);
  }, [persist]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(token),
      isLoading: false,
      email,
      isDemoMode: false,
      signIn,
      signInWithGoogle,
      signUp,
      acceptSession,
      signOut,
    }),
    [token, email, signIn, signInWithGoogle, signUp, acceptSession, signOut],
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

// Extrai a mensagem de erro da API (axios) ou de um Error comum.
export function apiErrorMessage(err: unknown): string {
  const anyErr = err as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const message = anyErr?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message ?? anyErr?.message ?? 'Algo deu errado. Tente novamente.';
}
