import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { apiErrorMessage } from '@/contexts/AuthContext';
import {
  authService,
  type DeviceAuthorizationInfo,
} from '@/services/auth.service';

type Etapa = 'carregando' | 'conferir' | 'aprovado' | 'negado' | 'erro';

/**
 * Tela de aprovação do device flow (rota /ativar).
 *
 * Ela existe para uma coisa só: colocar um humano entre o aplicativo e a conta
 * dele. Por isso o código aparece grande e a pessoa é convidada a COMPARAR com
 * o que está na tela do aplicativo, em vez de a aprovação acontecer sozinha
 * porque o link foi aberto — um link que aprova ao carregar seria um convite a
 * phishing: bastaria mandar a URL pronta para a vítima.
 *
 * O código também pode ser digitado à mão: o aplicativo nem sempre consegue
 * abrir o navegador da pessoa (máquina sem navegador padrão, sessão remota).
 */
export function AtivarDispositivoPage() {
  const [searchParams] = useSearchParams();
  const [codigo, setCodigo] = useState(
    (searchParams.get('code') ?? '').toUpperCase(),
  );
  const [info, setInfo] = useState<DeviceAuthorizationInfo | null>(null);
  const [etapa, setEtapa] = useState<Etapa>(
    searchParams.get('code') ? 'carregando' : 'conferir',
  );
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function carregar(userCode: string) {
    setErro('');
    setEtapa('carregando');
    try {
      const dados = await authService.deviceInfo(userCode.trim().toUpperCase());
      setInfo(dados);
      setEtapa(dados.status === 'pendente' ? 'conferir' : 'erro');
      if (dados.status !== 'pendente') {
        setErro(
          dados.status === 'aprovado'
            ? 'Este código já foi aprovado.'
            : 'Este código não vale mais. Gere um novo no aplicativo.',
        );
      }
    } catch (err) {
      setInfo(null);
      setEtapa('erro');
      setErro(apiErrorMessage(err));
    }
  }

  useEffect(() => {
    const daUrl = searchParams.get('code');
    if (daUrl) void carregar(daUrl);
    // Só na entrada: depois disso quem recarrega é o botão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function aprovar() {
    setEnviando(true);
    setErro('');
    try {
      await authService.approveDevice(codigo);
      setEtapa('aprovado');
    } catch (err) {
      setErro(apiErrorMessage(err));
    } finally {
      setEnviando(false);
    }
  }

  async function negar() {
    setEnviando(true);
    setErro('');
    try {
      await authService.denyDevice(codigo);
      setEtapa('negado');
    } catch (err) {
      setErro(apiErrorMessage(err));
    } finally {
      setEnviando(false);
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
      <Card sx={{ width: '100%', maxWidth: 460 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" gutterBottom textAlign="center">
            Pik
            <Box component="span" sx={{ color: 'primary.main' }}>
              Pok
            </Box>
          </Typography>

          {etapa === 'carregando' && (
            <Box textAlign="center" py={4}>
              <BrandLoader />
              <Typography color="text.secondary" mt={2}>
                Buscando o código...
              </Typography>
            </Box>
          )}

          {etapa === 'aprovado' && (
            <Stack spacing={2} alignItems="center" py={3}>
              <CheckCircleRoundedIcon color="success" sx={{ fontSize: 56 }} />
              <Typography variant="h6" textAlign="center">
                Dispositivo liberado
              </Typography>
              <Typography color="text.secondary" textAlign="center">
                Volte para o aplicativo — ele entra na sua conta em alguns
                segundos. Você pode fechar esta página.
              </Typography>
            </Stack>
          )}

          {etapa === 'negado' && (
            <Stack spacing={2} alignItems="center" py={3}>
              <ErrorRoundedIcon color="warning" sx={{ fontSize: 56 }} />
              <Typography variant="h6" textAlign="center">
                Pedido recusado
              </Typography>
              <Typography color="text.secondary" textAlign="center">
                Nenhum acesso foi liberado. Se não foi você quem tentou entrar,
                troque a sua senha por precaução.
              </Typography>
            </Stack>
          )}

          {(etapa === 'conferir' || etapa === 'erro') && (
            <Stack spacing={2.5}>
              <Stack spacing={1} alignItems="center">
                <DevicesRoundedIcon color="primary" sx={{ fontSize: 44 }} />
                <Typography variant="h6" textAlign="center">
                  Liberar acesso pelo aplicativo
                </Typography>
              </Stack>

              <Alert severity="warning">
                Ao liberar, este aplicativo passa a entrar na sua conta PikPok
                sozinho — com os seus dados, os seus créditos e os seus minutos
                de live. Só continue se foi você quem abriu o aplicativo agora e
                se o código abaixo é exatamente o que aparece na tela dele.
              </Alert>

              <TextField
                label="Código do aplicativo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                placeholder="PIKPOK-XXXX"
                fullWidth
                inputProps={{ style: { letterSpacing: 4, fontSize: 22 } }}
              />

              {info?.deviceName && (
                <Typography color="text.secondary" variant="body2">
                  Aplicativo: <strong>{info.deviceName}</strong>
                </Typography>
              )}

              {erro && <Alert severity="error">{erro}</Alert>}

              {info?.status === 'pendente' ? (
                <Stack direction="row" spacing={1.5}>
                  <Button
                    variant="contained"
                    fullWidth
                    disabled={enviando}
                    onClick={aprovar}
                  >
                    Liberar acesso
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    fullWidth
                    disabled={enviando}
                    onClick={negar}
                  >
                    Não fui eu
                  </Button>
                </Stack>
              ) : (
                <Button
                  variant="contained"
                  fullWidth
                  disabled={codigo.trim().length < 6}
                  onClick={() => void carregar(codigo)}
                >
                  Conferir código
                </Button>
              )}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
