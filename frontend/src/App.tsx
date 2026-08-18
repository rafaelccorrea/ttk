import { useEffect } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { captureReferral } from '@/utils/referral';
import { AppRoutes } from './routes';

export function App() {
  // Antes de qualquer rota: o `?ref=` chega na primeira URL aberta e some no
  // primeiro clique interno. Guardar aqui é o que mantém a indicação viva até
  // o cadastro, que pode acontecer minutos depois.
  useEffect(() => {
    captureReferral();
  }, []);

  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
