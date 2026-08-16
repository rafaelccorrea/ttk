import CreditCardIcon from '@mui/icons-material/CreditCard';
import LogoutIcon from '@mui/icons-material/Logout';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { billingService } from '@/services/billing.service';
import { useAuth } from '@/contexts/AuthContext';
import { resolveApiUrl } from '@/services/api';
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
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [feedback, setFeedback] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);

  /**
   * Manda o usuário para o Billing Portal do Stripe (cancelar, trocar cartão,
   * ver faturas). Conta sem assinatura ainda não tem customer lá, e o backend
   * responde 400 — daí a mensagem apontar para a página de planos.
   */
  const handleBilling = async () => {
    setIsOpeningPortal(true);
    try {
      const { url } = await billingService.portal();
      window.location.href = url;
    } catch {
      setFeedback({
        severity: 'error',
        message:
          'Não foi possível abrir a área de cobrança. Se você ainda não assinou, comece em Planos & Créditos.',
      });
      setIsOpeningPortal(false);
    }
  };

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

  async function trocarFoto(file: File) {
    setEnviandoFoto(true);
    try {
      setProfile(await usersService.uploadAvatar(file));
      setFeedback({ severity: 'success', message: 'Foto atualizada!' });
    } catch (error) {
      console.error(error);
      setFeedback({
        severity: 'error',
        message: 'Não foi possível enviar a foto. Tente outra imagem.',
      });
    } finally {
      setEnviandoFoto(false);
    }
  }

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
        <BrandLoader label="Carregando perfil..." />
      ) : (
        <Card sx={{ maxWidth: 560 }}>
          <CardContent sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={2.5} mb={3}>
              <Box sx={{ position: 'relative' }}>
                <Avatar
                  component="label"
                  src={
                    profile?.avatarUrl
                      ? resolveApiUrl(profile.avatarUrl)
                      : undefined
                  }
                  sx={{
                    width: 72,
                    height: 72,
                    fontSize: 32,
                    fontWeight: 800,
                    bgcolor: 'primary.main',
                    color: '#fff',
                    cursor: enviandoFoto ? 'wait' : 'pointer',
                    '&:hover .trocar-foto': { opacity: 1 },
                  }}
                >
                  {!profile?.avatarUrl && initial}
                  {/* A camada só aparece no hover: fora dele, o que importa é
                      a foto, não o convite para trocá-la. */}
                  <Box
                    className="trocar-foto"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'rgba(0,0,0,0.55)',
                      opacity: enviandoFoto ? 1 : 0,
                      transition: 'opacity .15s',
                    }}
                  >
                    <PhotoCameraRoundedIcon fontSize="small" />
                  </Box>
                  <input
                    hidden
                    type="file"
                    accept="image/*"
                    disabled={enviandoFoto}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void trocarFoto(file);
                    }}
                  />
                </Avatar>
              </Box>
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

            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                startIcon={<CreditCardIcon />}
                onClick={handleBilling}
                disabled={isOpeningPortal}
              >
                {isOpeningPortal ? 'Abrindo…' : 'Gerenciar assinatura'}
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={() => void signOut()}
              >
                Sair da conta
              </Button>
            </Box>
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
