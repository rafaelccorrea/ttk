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
      py={4}
      sx={{
        bgcolor: 'background.default',
        // A página de ativação é vista UMA vez por computador e sempre vinda de
        // fora do site (o app abriu o navegador). O halo da marca é o que faz
        // ela parecer a mesma empresa do aplicativo que acabou de abri-la, em
        // vez de um formulário solto num fundo cinza.
        backgroundImage:
          'radial-gradient(60% 50% at 50% 0%, rgba(254,44,85,0.10) 0%, transparent 70%),' +
          'radial-gradient(50% 40% at 100% 100%, rgba(0,194,187,0.08) 0%, transparent 70%)',
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth: 470,
          borderRadius: 4,
          boxShadow: '0 18px 60px rgba(22,24,35,0.10)',
          // O card não reage ao ponteiro: aqui não há nada para clicar nele
          // inteiro, e o hover herdado do tema sugeriria que há.
          '&:hover': { boxShadow: '0 18px 60px rgba(22,24,35,0.10)' },
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack direction="row" spacing={1.25} alignItems="center" justifyContent="center" mb={3}>
            <Box
              component="img"
              src="/icon-192.png"
              alt=""
              sx={{ width: 34, height: 34, borderRadius: 2 }}
            />
            <Typography variant="h6" fontWeight={800}>
              Pik
              <Box component="span" sx={{ color: 'primary.main' }}>
                Pok
              </Box>
            </Typography>
          </Stack>

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
              <Box
                sx={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'success.main',
                  bgcolor: 'rgba(22,163,74,0.10)',
                  // O anel cresce uma vez, no aparecimento: é o fecho de um
                  // fluxo que começou noutra tela, e vale marcar a chegada.
                  animation: 'entra .35s ease-out',
                  '@keyframes entra': {
                    from: { transform: 'scale(0.85)', opacity: 0 },
                    to: { transform: 'scale(1)', opacity: 1 },
                  },
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }}
              >
                <CheckCircleRoundedIcon sx={{ fontSize: 40 }} />
              </Box>
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
              <Stack spacing={1.25} alignItems="center">
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'primary.main',
                    bgcolor: 'rgba(254,44,85,0.08)',
                  }}
                >
                  <DevicesRoundedIcon sx={{ fontSize: 30 }} />
                </Box>
                <Typography variant="h6" textAlign="center">
                  Liberar acesso pelo aplicativo
                </Typography>
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  Confira se o código abaixo é o mesmo que está na tela do
                  aplicativo antes de liberar.
                </Typography>
              </Stack>

              {/*
                O aviso deixa de ser um `Alert` amarelo de biblioteca e vira
                texto com uma barra na lateral. O amarelo de sistema é o mesmo
                de "cookies" e "sua sessão vai expirar", e é lido como ruído
                dispensável — que é exatamente o oposto do que este parágrafo
                precisa ser, já que ele é a única defesa contra alguém liberar
                um código de phishing.
              */}
              <Box
                sx={{
                  p: 2,
                  pl: 2.25,
                  borderRadius: 3,
                  position: 'relative',
                  overflow: 'hidden',
                  bgcolor: 'rgba(245,158,11,0.07)',
                  border: '1px solid rgba(245,158,11,0.28)',
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    bgcolor: '#f59e0b',
                  },
                }}
              >
                <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                  Ao liberar, este aplicativo passa a entrar na sua conta PikPok
                  sozinho — com os seus dados, os seus créditos e os seus
                  minutos de live. Só continue se foi <strong>você</strong> quem
                  abriu o aplicativo agora.
                </Typography>
              </Box>

              <TextField
                label="Código do aplicativo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                placeholder="PIKPOK-XXXX"
                fullWidth
                inputProps={{
                  style: {
                    letterSpacing: '0.22em',
                    // 24px com letter-spacing não cabe em 360px de largura;
                    // a fonte acompanha a tela (clamp) sem perder o destaque.
                    fontSize: 'clamp(18px, 5.5vw, 24px)',
                    fontWeight: 700,
                    textAlign: 'center',
                    // Monoespaçada: este código é comparado caractere a
                    // caractere com o da outra tela, e é aí que 0 e O, 1 e l
                    // custam caro.
                    fontFamily:
                      'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
                    // Compensa o espaço que o `letter-spacing` adiciona depois
                    // do último caractere e que tira o texto do centro.
                    textIndent: '0.22em',
                  },
                }}
              />

              {info?.deviceName && (
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    px: 1.75,
                    py: 1.25,
                    borderRadius: 3,
                    bgcolor: 'rgba(22,24,35,0.03)',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <DevicesRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    Aplicativo
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="body2" fontWeight={700} noWrap sx={{ minWidth: 0, maxWidth: '60%' }}>
                    {info.deviceName}
                  </Typography>
                </Stack>
              )}

              {erro && <Alert severity="error" sx={{ wordBreak: 'break-word' }}>{erro}</Alert>}

              {info?.status === 'pendente' ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
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
