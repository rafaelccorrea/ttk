import { LockResetRounded, Visibility, VisibilityOff } from '@mui/icons-material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { apiErrorMessage, useAuth } from '@/contexts/AuthContext';
import { authService } from '@/services/auth.service';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { acceptSession } = useAuth();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    try {
      const result = await authService.resetPassword(token, password);
      // O backend já devolve a sessão — entra direto, sem pedir login de novo.
      acceptSession(result.accessToken, result.user.email);
      setDone(result.message);
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (err) {
      setError(apiErrorMessage(err));
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
      sx={{ bgcolor: 'background.default' }}
    >
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" gutterBottom>
            Pik
            <Box component="span" sx={{ color: 'primary.main' }}>
              Pok
            </Box>
          </Typography>

          {done ? (
            <Box textAlign="center">
              <CheckCircleRoundedIcon color="success" sx={{ fontSize: 56, my: 2 }} />
              <Typography color="text.secondary" mb={1}>
                {done}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Redirecionando para o painel...
              </Typography>
            </Box>
          ) : !token ? (
            <Box textAlign="center">
              <Typography color="text.secondary" my={3}>
                Link inválido — o endereço não tem token de redefinição.
              </Typography>
              <Button component={RouterLink} to="/esqueci-a-senha" variant="contained" fullWidth>
                Pedir um novo link
              </Button>
            </Box>
          ) : (
            <>
              <Typography variant="h6" mt={1}>
                Criar nova senha
              </Typography>
              <Typography color="text.secondary" mb={2}>
                Escolha uma senha com pelo menos 10 caracteres.
              </Typography>
              <form onSubmit={handleSubmit}>
                <TextField
                  label="Nova senha"
                  type={showPassword ? 'text' : 'password'}
                  fullWidth
                  required
                  autoFocus
                  inputProps={{ minLength: 10 }}
                  autoComplete="new-password"
                  margin="normal"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                          onClick={() => setShowPassword((v) => !v)}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  label="Repita a nova senha"
                  type={showPassword ? 'text' : 'password'}
                  fullWidth
                  required
                  autoComplete="new-password"
                  margin="normal"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
                {error && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {error}
                  </Alert>
                )}
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={busy}
                  startIcon={
                    busy ? (
                      <CircularProgress size={18} color="inherit" />
                    ) : (
                      <LockResetRounded />
                    )
                  }
                  sx={{ mt: 3, py: 1.3 }}
                >
                  {busy ? 'Salvando…' : 'Salvar nova senha'}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
