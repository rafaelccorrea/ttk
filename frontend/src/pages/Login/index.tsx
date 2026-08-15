import {
  ArrowBackRounded,
  AutoFixHighRounded,
  CelebrationRounded,
  LoginRounded,
  MarkEmailUnreadRounded,
  PersonAddRounded,
  LocalFireDepartmentRounded,
  OndemandVideoRounded,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useEffect, useState } from 'react';
import { Link as RouterLink, Navigate, useNavigate } from 'react-router-dom';
import { apiErrorMessage, useAuth } from '@/contexts/AuthContext';
import { authService } from '@/services/auth.service';

// Mensagens de erro de autenticação traduzidas para o usuário.
function translateAuthError(err: unknown): string {
  const message = apiErrorMessage(err);
  const map: Array<[RegExp, string]> = [
    [/email not confirmed/i, 'Confirme seu e-mail antes de entrar — enviamos um link de confirmação para sua caixa de entrada.'],
    [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/user already registered/i, 'Este e-mail já tem conta — use "Já tenho conta".'],
    [/password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
    [/rate limit/i, 'Muitas tentativas — aguarde um instante e tente de novo.'],
  ];
  for (const [pattern, text] of map) {
    if (pattern.test(message)) return text;
  }
  return message || 'Falha no login';
}

const red = '#fe2c55';
const cyan = '#25f4ee';
const textDim = 'rgba(255,255,255,0.66)';

const BRAND_POINTS = [
  { icon: <LocalFireDepartmentRounded fontSize="small" />, text: 'Produtos em alta com receita estimada em tempo real' },
  { icon: <OndemandVideoRounded fontSize="small" />, text: 'Os vídeos e criadores que mais convertem por nicho' },
  { icon: <AutoFixHighRounded fontSize="small" />, text: 'Roteiros gerados por IA prontos para gravar' },
];

export function LoginPage() {
  const { isAuthenticated, isDemoMode, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Soft launch: quando o cadastro cai na fila, a coluna do formulário dá
  // lugar à confirmação de entrada na lista.
  const [waitlist, setWaitlist] = useState<{
    position?: number;
    total?: number;
  } | null>(null);
  // Modo lista de espera vindo do backend, para a tela avisar ANTES do envio
  // em vez de prometer "conta grátis" e entregar uma fila.
  const [waitlistMode, setWaitlistMode] = useState(false);

  useEffect(() => {
    authService
      .config()
      .then((c) => setWaitlistMode(c.waitlist))
      // Config indisponível não pode travar o login: segue no fluxo normal.
      .catch(() => undefined);
  }, []);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setPreviewUrl(null);
    setBusy(true);
    try {
      if (isSignUp) {
        const result = await signUp(email, password);
        if (result.waitlisted) {
          setWaitlist({ position: result.position, total: result.total });
          return;
        }
        // Fluxo normal: confirmação por e-mail (link enviado via Nodemailer).
        setInfo(result.message);
        setPreviewUrl(result.previewUrl ?? null);
        setIsSignUp(false);
      } else {
        await signIn(email, password);
        navigate('/dashboard');
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box display="flex" minHeight="100vh">
      {/* Painel de marca (esquerda, some no mobile) */}
      <Box
        sx={{
          flex: 1,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          color: '#fff',
          background: `radial-gradient(60% 50% at 20% 10%, ${red}30 0%, transparent 60%), radial-gradient(50% 45% at 90% 90%, ${cyan}26 0%, transparent 60%), #0d0e14`,
        }}
      >
        <Stack
          component={RouterLink}
          to="/"
          direction="row"
          spacing={1.25}
          alignItems="center"
          sx={{ textDecoration: 'none', width: 'fit-content' }}
        >
          <Box
            component="img"
            src="/icon-192.png"
            alt="PikPok"
            sx={{ width: 38, height: 38, borderRadius: 2, boxShadow: `0 4px 14px ${red}44` }}
          />
          <Typography fontWeight={800} fontSize={22} sx={{ color: '#fff', letterSpacing: '-0.02em' }}>
            Pik<Box component="span" sx={{ color: red }}>Pok</Box>
          </Typography>
        </Stack>

        <Box maxWidth={440}>
          <Typography sx={{ fontSize: 36, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            Venda antes da tendência virar{' '}
            <Box
              component="span"
              sx={{
                background: `linear-gradient(92deg, ${red}, ${cyan})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              concorrência
            </Box>
          </Typography>
          <Stack spacing={2.5} mt={5}>
            {BRAND_POINTS.map((p) => (
              <Stack key={p.text} direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    width: 36, height: 36, borderRadius: 2.5, display: 'grid', placeItems: 'center',
                    flexShrink: 0, background: `linear-gradient(135deg, ${red}30, ${cyan}30)`,
                  }}
                >
                  {p.icon}
                </Box>
                <Typography fontSize={15} color={textDim}>{p.text}</Typography>
              </Stack>
            ))}
          </Stack>
        </Box>

        <Typography fontSize={13} color="rgba(255,255,255,0.4)">
          © {new Date().getFullYear()} PikPok — inteligência de produtos para o TikTok Shop
        </Typography>
      </Box>

      {/* Formulário (direita) */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: { xs: 3, sm: 6 },
          py: 6,
          bgcolor: 'background.default',
        }}
      >
        <Box width="100%" maxWidth={400}>
          <Button
            component={RouterLink}
            to="/"
            startIcon={<ArrowBackRounded />}
            size="small"
            sx={{ mb: 3, color: 'text.secondary' }}
          >
            Voltar para o início
          </Button>

          {waitlist ? (
            <Box>
              <Box
                sx={{
                  width: 64, height: 64, borderRadius: '50%', mb: 3,
                  display: 'grid', placeItems: 'center',
                  background: `linear-gradient(135deg, ${red}, ${cyan})`,
                }}
              >
                <CelebrationRounded sx={{ fontSize: 32, color: '#fff' }} />
              </Box>

              <Typography variant="h4" gutterBottom>
                Você entrou na lista de espera!
              </Typography>

              {waitlist.position != null && (
                <Typography color="text.secondary" mb={1}>
                  Você é o número{' '}
                  <Box component="span" sx={{ color: 'primary.main', fontWeight: 800 }}>
                    {waitlist.position}
                  </Box>{' '}
                  da fila.
                </Typography>
              )}

              <Typography color="text.secondary" mb={3}>
                A procura foi bem maior do que a gente esperava, então estamos
                abrindo o acesso aos poucos para todo mundo ter uma boa
                experiência desde o primeiro dia.
              </Typography>

              <Alert severity="info" icon={<MarkEmailUnreadRounded />} sx={{ mb: 3 }}>
                <strong>Quando chegar a sua vez</strong>, enviaremos o link de
                confirmação para <strong>{email}</strong>. Só depois de abrir
                esse link a sua conta fica ativa — não é preciso fazer mais nada
                agora.
              </Alert>

              <Button
                component={RouterLink}
                to="/"
                variant="contained"
                size="large"
                fullWidth
                sx={{ py: 1.3 }}
              >
                Voltar para o início
              </Button>
            </Box>
          ) : (
          <>
          <Typography variant="h4" gutterBottom>
            {isSignUp
              ? waitlistMode
                ? 'Entre na lista de espera'
                : 'Crie sua conta'
              : 'Bem-vindo de volta'}
          </Typography>
          <Typography color="text.secondary" mb={3}>
            {isSignUp
              ? waitlistMode
                ? 'Estamos liberando o acesso aos poucos. Deixe seu e-mail e senha para garantir seu lugar na fila.'
                : 'Comece grátis — sem cartão de crédito.'
              : 'Entre para acessar seu painel do TikTok Shop.'}
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
              autoFocus
              autoComplete="email"
              margin="normal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!isDemoMode && (
              <TextField
                label="Senha"
                type={showPassword ? 'text' : 'password'}
                fullWidth
                required
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
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
            )}
            {!isDemoMode && !isSignUp && (
              <Box display="flex" justifyContent="flex-end" mt={0.5}>
                <Box
                  component={RouterLink}
                  to="/esqueci-a-senha"
                  sx={{
                    color: 'text.secondary',
                    fontSize: 14,
                    textDecoration: 'none',
                    '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                  }}
                >
                  Esqueceu a senha?
                </Box>
              </Box>
            )}
            {info && (
              <Alert severity="success" sx={{ mt: 1 }}>
                {info}
                {previewUrl && (
                  <>
                    {' '}
                    <a href={previewUrl} target="_blank" rel="noreferrer">
                      Ver e-mail de teste
                    </a>
                  </>
                )}
              </Alert>
            )}
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
                ) : isSignUp ? (
                  <PersonAddRounded />
                ) : (
                  <LoginRounded />
                )
              }
              sx={{
                mt: 3, py: 1.4,
                transition: 'transform .15s ease, box-shadow .2s ease',
                '&:hover': { transform: 'translateY(-1px)' },
                '&:active': { transform: 'scale(0.98)' },
              }}
            >
              {busy
                ? 'Aguarde…'
                : isSignUp
                  ? waitlistMode
                    ? 'Garantir meu lugar'
                    : 'Criar conta grátis'
                  : 'Entrar'}
            </Button>
            {!isDemoMode && (
              <Typography textAlign="center" fontSize={14} color="text.secondary" mt={2.5}>
                {isSignUp ? 'Já tem conta?' : 'Ainda não tem conta?'}{' '}
                <Box
                  component="button"
                  type="button"
                  onClick={() => {
                    setIsSignUp((v) => !v);
                    setError(null);
                  }}
                  sx={{
                    border: 0, p: 0, background: 'none', cursor: 'pointer',
                    color: 'primary.main', fontWeight: 700, fontSize: 'inherit', fontFamily: 'inherit',
                  }}
                >
                  {isSignUp ? 'Entrar' : 'Criar uma conta'}
                </Box>
              </Typography>
            )}
          </form>
          </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
