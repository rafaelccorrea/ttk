import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded';
import HeadsetMicRoundedIcon from '@mui/icons-material/HeadsetMicRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Stack,
  Typography,
} from '@mui/material';
import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from '@/services/billing.service';

/**
 * Chave por conta: duas pessoas no mesmo navegador não dividem o "já vi".
 * Fica no navegador, e não no servidor, de propósito — é um aviso, não um
 * direito; se um dia sumir e aparecer de novo, o pior que acontece é o
 * vendedor ler duas vezes o que ele tem de graça.
 */
const chave = (email: string) => `pikpok.boas-vindas:${email.toLowerCase()}`;

function jaViu(email: string): boolean {
  try {
    return localStorage.getItem(chave(email)) === '1';
  } catch {
    return true; // sem storage (modo privado bloqueado), não insiste
  }
}

function marcarVisto(email: string) {
  try {
    localStorage.setItem(chave(email), '1');
  } catch {
    /* sem storage: aparece de novo na próxima, e só */
  }
}

/**
 * Quando o modal ainda faz sentido: conta gratuita que ainda não tocou em
 * nada. Assinante já comprou o catálogo; quem já gastou crédito ou já usou o
 * vídeo grátis já descobriu sozinho o que tinha — anunciar presente gasto é
 * ruído. E quem já dispensou o aviso não o vê de novo.
 */
export function deveMostrar(carteira: Wallet, email: string): boolean {
  if (!carteira.freeSample?.active) return false;
  if (carteira.plan !== 'free') return false;
  if (carteira.sampleVideo && !carteira.sampleVideo.available) return false;
  if (carteira.history?.some((t) => t.kind === 'spend')) return false;
  if (carteira.credits <= 0) return false;
  return !jaViu(email);
}

interface Props {
  carteira: Wallet | null;
  email: string | null;
}

/**
 * O primeiro login da conta gratuita: o que ela tem de graça, dito de uma vez.
 *
 * Sem isto a cortesia é invisível — os 25 créditos aparecem como um número no
 * canto, o vídeo de cortesia só se descobre abrindo a tela certa, e os dez
 * minutos de live só quando a primeira transmissão começa. Um presente que
 * ninguém sabe que ganhou não converte ninguém. O modal existe para transformar
 * "conta criada" em "vem cá ver o seu produto virar vídeo".
 *
 * Só aparece para quem está no modo amostra (`freeSample.active`): assinante
 * já viu o catálogo do plano na hora de pagar.
 */
export function WelcomeModal({ carteira, email }: Props) {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!carteira || !email) return;
    setAberto(deveMostrar(carteira, email));
  }, [carteira, email]);

  if (!carteira || !email) return null;

  /** "Entendi" / CTA: viu, não volta. */
  const fechar = () => {
    marcarVisto(email);
    setAberto(false);
  };
  /** "Perguntar depois": fecha sem marcar — volta no próximo acesso. */
  const adiar = () => setAberto(false);

  const video = carteira.sampleVideo;
  const live = carteira.liveCopilot;
  const amostra = carteira.freeSample;

  const itens: Array<{ icone: ReactNode; titulo: string; texto: string } | null> = [
    video?.available
      ? {
          icone: <MovieFilterRoundedIcon />,
          titulo: '1 vídeo com IA por nossa conta',
          texto: `Gere um vídeo completo do seu produto sem gastar nada — vale ${video.credits} créditos e é o que a Fábrica faz em escala no plano Pro.`,
        }
      : null,
    {
      icone: <AutoAwesomeRoundedIcon />,
      titulo: `${carteira.credits} créditos de boas-vindas`,
      texto: 'Dão para uns três roteiros, ou uma análise de vídeo viral e um roteiro, ou duas imagens. Use com o SEU produto.',
    },
    live?.trialAvailable
      ? {
          icone: <HeadsetMicRoundedIcon />,
          titulo: `${live.trialMinutes} minutos de Live Copilot`,
          texto: 'Ligue o copiloto numa live de verdade e veja ele responder o chat por você.',
        }
      : null,
    amostra
      ? {
          icone: <TrendingUpRoundedIcon />,
          titulo: 'Amostra do que está vendendo',
          texto: `${amostra.products} produtos e ${amostra.videos} vídeos que estão convertendo agora, atualizados a cada ${amostra.refreshDays} dias.`,
        }
      : null,
  ];

  return (
    <Dialog open={aberto} onClose={adiar} maxWidth="xs" fullWidth>
      <DialogContent sx={{ pt: 4, pb: 1 }}>
        <Stack alignItems="center" textAlign="center" spacing={1} mb={3}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'rgba(0,194,187,0.14)',
              color: '#00c2bb',
            }}
          >
            <CardGiftcardRoundedIcon fontSize="large" />
          </Box>
          <Typography variant="h5" fontWeight={800}>
            Sua conta veio com presente
          </Typography>
          <Typography color="text.secondary">
            Tudo isto é seu, sem cartão e sem prazo. É para você testar com o seu produto —
            não com um exemplo nosso.
          </Typography>
        </Stack>
        <Stack spacing={2}>
          {itens.filter(Boolean).map((item) => (
            <Stack key={item!.titulo} direction="row" spacing={1.5} alignItems="flex-start">
              <Box sx={{ color: '#fe2c55', mt: 0.25, display: 'flex' }}>{item!.icone}</Box>
              <Box>
                <Typography fontWeight={700}>{item!.titulo}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {item!.texto}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, pt: 2, flexDirection: 'column', gap: 1 }}>
        <Button
          fullWidth
          variant="contained"
          size="large"
          component={Link}
          to={video?.available ? '/prompts' : '/estudio'}
          onClick={fechar}
          startIcon={video?.available ? <MovieFilterRoundedIcon /> : <AutoAwesomeRoundedIcon />}
        >
          {video?.available ? 'Gerar meu vídeo grátis' : 'Começar pelo roteiro'}
        </Button>
        <Button fullWidth color="inherit" onClick={fechar}>
          Entendi, vou explorar
        </Button>
        <Button fullWidth size="small" color="inherit" onClick={adiar} sx={{ opacity: 0.7 }}>
          Perguntar depois
        </Button>
      </DialogActions>
    </Dialog>
  );
}
