import { Box } from '@mui/material';
import { useEffect, useRef } from 'react';

/*
 * Botão oficial do Google Identity Services.
 *
 * O script do GIS é carregado sob demanda (só quem abre a tela de login paga
 * por ele) e uma única vez por sessão. O Google renderiza o botão dentro do
 * div e devolve no callback um `credential` (id_token JWT) — que a gente NÃO
 * interpreta aqui: vai cru para o backend, que é quem valida assinatura e
 * audience. O frontend só transporta.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

// Tipagem mínima do objeto global que o script injeta.
interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

let gisLoading: Promise<void> | null = null;

export function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Permite nova tentativa se o script falhar (rede, adblock).
      gisLoading = null;
      reject(new Error('Não foi possível carregar o login do Google.'));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

interface GoogleLoginButtonProps {
  clientId: string;
  onCredential: (credential: string) => void;
  onError?: (message: string) => void;
}

export function GoogleLoginButton({
  clientId,
  onCredential,
  onError,
}: GoogleLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Refs para os callbacks: o GIS só aceita UM initialize por página, então o
  // callback registrado precisa enxergar sempre a versão mais recente.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    loadGis()
      .then(() => {
        const gis = window.google?.accounts?.id;
        if (cancelled || !gis || !containerRef.current) return;
        gis.initialize({
          client_id: clientId,
          callback: (response) => onCredentialRef.current(response.credential),
        });
        gis.renderButton(containerRef.current, {
          theme: 'outline',
          size: 'large',
          // O iframe do Google tem largura fixa: 400px num celular de 360px
          // estourava a tela. Cabe no que o wrapper tem.
          width: Math.min(400, containerRef.current.clientWidth || 400),
          text: 'continue_with',
          locale: 'pt-BR',
        });
      })
      .catch((err: Error) => {
        if (!cancelled) onErrorRef.current?.(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // O iframe do Google tem largura própria; o wrapper centraliza. A altura
  // mínima reserva o espaço do botão desde o primeiro paint — sem ela a tela
  // "pula" quando o Google termina de renderizar.
  return (
    <Box
      ref={containerRef}
      display="flex"
      justifyContent="center"
      minHeight={44}
      sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}
    />
  );
}
