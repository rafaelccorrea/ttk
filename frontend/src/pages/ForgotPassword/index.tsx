import { ArrowBackRounded, SendRounded } from '@mui/icons-material';
import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { apiErrorMessage } from '@/contexts/AuthContext';
import { authService } from '@/services/auth.service';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await authService.forgotPassword(email);
      setSent(result.message);
      setPreviewUrl(result.previewUrl ?? null);
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

          {sent ? (
            <Box textAlign="center">
              <MarkEmailReadRoundedIcon
                color="success"
                sx={{ fontSize: 56, my: 2 }}
              />
              <Typography color="text.secondary" mb={1}>
                {sent}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                O link vale por 1 hora. Confira também a caixa de spam.
              </Typography>
              {previewUrl && (
                <Alert severity="info" sx={{ mb: 2, textAlign: 'left' }}>
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    Ver e-mail de teste
                  </a>
                </Alert>
              )}
              <Button component={RouterLink} to="/login" variant="contained" fullWidth>
                Voltar para o login
              </Button>
            </Box>
          ) : (
            <>
              <Typography variant="h6" mt={1}>
                Esqueceu a senha?
              </Typography>
              <Typography color="text.secondary" mb={2}>
                Informe seu e-mail e enviaremos um link para você criar uma nova.
              </Typography>
              <form onSubmit={handleSubmit}>
                <TextField
                  label="E-mail"
                  type="email"
                  fullWidth
                  required
                  autoFocus
                  autoComplete="email"
                  margin="normal"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                      <SendRounded />
                    )
                  }
                  sx={{ mt: 3, py: 1.3 }}
                >
                  {busy ? 'Enviando…' : 'Enviar link de redefinição'}
                </Button>
              </form>
              <Button
                component={RouterLink}
                to="/login"
                startIcon={<ArrowBackRounded />}
                size="small"
                fullWidth
                sx={{ mt: 2, color: 'text.secondary' }}
              >
                Voltar para o login
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
