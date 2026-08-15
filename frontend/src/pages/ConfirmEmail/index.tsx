import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
} from '@mui/material';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiErrorMessage, useAuth } from '@/contexts/AuthContext';
import { authService } from '@/services/auth.service';

type Status = 'loading' | 'success' | 'error';

export function ConfirmEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { acceptSession } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('Confirmando seu e-mail...');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode: evita confirmar duas vezes
    ran.current = true;
    const token = searchParams.get('token') ?? '';
    authService
      .confirm(token)
      .then((result) => {
        acceptSession(result.accessToken, result.user.email);
        setStatus('success');
        setMessage(result.message);
        setTimeout(() => navigate('/dashboard'), 1500);
      })
      .catch((err) => {
        setStatus('error');
        setMessage(apiErrorMessage(err));
      });
  }, [searchParams, acceptSession, navigate]);

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
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h5" gutterBottom>
            Pik
            <Box component="span" sx={{ color: 'primary.main' }}>
              Pok
            </Box>
          </Typography>
          {status === 'loading' && (
            <BrandLoader label="Confirmando..." minHeight={140} />
          )}
          {status === 'success' && (
            <CheckCircleRoundedIcon
              color="success"
              sx={{ fontSize: 56, my: 2 }}
            />
          )}
          {status === 'error' && (
            <ErrorRoundedIcon color="error" sx={{ fontSize: 56, my: 2 }} />
          )}
          <Typography color="text.secondary" mb={3}>
            {message}
          </Typography>
          {status === 'success' && (
            <Typography variant="body2" color="text.secondary">
              Redirecionando para o painel...
            </Typography>
          )}
          {status === 'error' && (
            <Button component={Link} to="/login" variant="contained">
              Ir para o login
            </Button>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
