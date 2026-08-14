import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function LoginPage() {
  const { isAuthenticated, isDemoMode, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignUp) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      px={2}
    >
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            PikPok
          </Typography>
          <Typography color="text.secondary" gutterBottom>
            Inteligência de produtos para o TikTok Shop
          </Typography>
          {isDemoMode && (
            <Chip
              label="Modo demo — sem Supabase configurado, qualquer e-mail entra"
              color="secondary"
              size="small"
              sx={{ mb: 2 }}
            />
          )}
          <form onSubmit={handleSubmit}>
            <TextField
              label="E-mail"
              type="email"
              fullWidth
              required
              margin="normal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!isDemoMode && (
              <TextField
                label="Senha"
                type="password"
                fullWidth
                required
                margin="normal"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            {error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {error}
              </Alert>
            )}
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={busy}
              sx={{ mt: 2 }}
            >
              {isSignUp ? 'Criar conta' : 'Entrar'}
            </Button>
            {!isDemoMode && (
              <Button
                fullWidth
                sx={{ mt: 1 }}
                onClick={() => setIsSignUp((v) => !v)}
              >
                {isSignUp ? 'Já tenho conta' : 'Criar uma conta'}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
