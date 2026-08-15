import LogoutIcon from '@mui/icons-material/Logout';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usersService, UserProfile } from '@/services/users.service';

const PLAN_LABELS: Record<string, string> = {
  free: 'Gratuito',
  pro: 'Pro',
  premium: 'Premium',
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
}

export function ProfilePage() {
  const { email, signOut } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    usersService
      .me()
      .then((data) => {
        setProfile(data);
        setDisplayName(data.displayName ?? '');
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  async function handleSave() {
    setIsSaving(true);
    try {
      const updated = await usersService.updateProfile(displayName.trim());
      setProfile(updated);
      setDisplayName(updated.displayName ?? '');
      setFeedback({
        severity: 'success',
        message: 'Perfil atualizado com sucesso!',
      });
    } catch (error) {
      console.error(error);
      setFeedback({
        severity: 'error',
        message: 'Não foi possível salvar. Tente novamente.',
      });
    } finally {
      setIsSaving(false);
    }
  }

  const shownEmail = profile?.email ?? email ?? '';
  const initial = shownEmail ? shownEmail[0].toUpperCase() : '?';
  const planKey = (profile?.plan ?? '').toLowerCase();

  return (
    <>
      <Typography variant="h5">Meu Perfil</Typography>
      <Typography color="text.secondary" mb={3}>
        Gerencie as informações da sua conta.
      </Typography>

      {isLoading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : (
        <Card sx={{ maxWidth: 560 }}>
          <CardContent sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={2.5} mb={3}>
              <Avatar
                sx={{
                  width: 72,
                  height: 72,
                  fontSize: 32,
                  fontWeight: 800,
                  bgcolor: 'primary.main',
                  color: '#fff',
                }}
              >
                {initial}
              </Avatar>
              <Box>
                <Typography fontWeight={700} fontSize={18}>
                  {profile?.displayName || shownEmail}
                </Typography>
                <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                  <Chip
                    size="small"
                    label={`Plano ${PLAN_LABELS[planKey] ?? profile?.plan ?? '—'}`}
                    sx={{
                      fontWeight: 700,
                      bgcolor: 'rgba(0,194,187,0.12)',
                      color: 'secondary.main',
                    }}
                  />
                  {profile?.createdAt && (
                    <Typography variant="caption" color="text.secondary">
                      Membro desde {formatDate(profile.createdAt)}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>

            <Box display="flex" flexDirection="column" gap={2.5}>
              <TextField
                label="E-mail"
                value={shownEmail}
                fullWidth
                InputProps={{ readOnly: true }}
                helperText="O e-mail não pode ser alterado."
              />
              <TextField
                label="Nome de exibição"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                fullWidth
                placeholder="Como você quer ser chamado"
              />
              <Box>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? 'Salvando…' : 'Salvar'}
                </Button>
              </Box>
            </Box>

            <Divider sx={{ my: 3, borderColor: 'rgba(22,24,35,0.08)' }} />

            <Button
              variant="outlined"
              color="error"
              startIcon={<LogoutIcon />}
              onClick={() => void signOut()}
            >
              Sair da conta
            </Button>
          </CardContent>
        </Card>
      )}

      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={4000}
        onClose={() => setFeedback(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={feedback?.severity ?? 'success'}
          variant="filled"
          onClose={() => setFeedback(null)}
        >
          {feedback?.message}
        </Alert>
      </Snackbar>
    </>
  );
}
