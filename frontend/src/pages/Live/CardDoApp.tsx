import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import { DownloadDoApp, liveService } from '@/services/live.service';

/**
 * O convite para baixar o app de desktop.
 *
 * Ele existe porque, sem ele, o produto tem uma metade invisível: a base de
 * conhecimento é montada aqui na web, mas quem responde o chat durante a
 * transmissão é o aplicativo — e o vendedor não tinha por onde descobrir que ele
 * existe, muito menos como obtê-lo.
 *
 * Duas decisões de honestidade, e as duas custam conversão de propósito:
 *
 *  1. Enquanto não há instalador publicado, o card diz "em breve" em vez de
 *     mostrar um botão. Botão que baixa 404 é pior do que ausência de botão —
 *     o primeiro queima confiança, o segundo só não ajuda.
 *  2. Quando o instalador não é assinado, o aviso do SmartScreen do Windows é
 *     anunciado AQUI, antes do download. Descobrir aquela tela azul no meio da
 *     instalação faz o vendedor achar que baixou vírus; ler antes que vai
 *     acontecer transforma o susto em expectativa.
 */
export function CardDoApp({ paraQuem }: { paraQuem: 'lista' | 'detalhe' }) {
  const [info, setInfo] = useState<DownloadDoApp | null>(null);

  useEffect(() => {
    let vivo = true;
    liveService
      .getDownload()
      .then((r) => {
        if (vivo) setInfo(r);
      })
      // Falha aqui não merece alarme na tela: o card é um complemento, e a
      // ausência dele não impede ninguém de montar a base de conhecimento.
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  if (!info) return null;

  const naoAssinado = info.disponivel && !info.assinado;

  return (
    <Card sx={{ p: { xs: 2, md: 2.5 }, mb: 3 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ md: 'center' }}
      >
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'rgba(254,44,85,0.1)',
            flexShrink: 0,
          }}
        >
          <DesktopWindowsRoundedIcon sx={{ color: '#fe2c55' }} />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
            <Typography variant="subtitle1" fontWeight={800}>
              O copiloto que fica com você na live
            </Typography>
            {info.versao && (
              <Chip size="small" variant="outlined" label={`v${info.versao}`} />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {paraQuem === 'detalhe'
              ? 'Esta base já pode ser usada ao vivo. O aplicativo de computador lê o chat da sua transmissão e responde com o que está aqui.'
              : 'A base é montada aqui. Durante a transmissão, quem lê o chat e responde é o aplicativo de computador — ele precisa do TikTok aberto na mesma máquina.'}
          </Typography>
        </Box>

        {info.disponivel ? (
          <Stack spacing={1} sx={{ flexShrink: 0 }}>
            {info.windows && (
              <Button
                variant="contained"
                startIcon={<DownloadRoundedIcon />}
                href={info.windows}
                // Download é navegação para fora: sem isto, um clique no meio de
                // um upload em andamento trocaria a página e mataria o envio.
                target="_blank"
                rel="noopener"
              >
                Baixar para Windows
              </Button>
            )}
            {info.mac && (
              <Button
                variant="outlined"
                startIcon={<DownloadRoundedIcon />}
                href={info.mac}
                target="_blank"
                rel="noopener"
              >
                Baixar para Mac
              </Button>
            )}
          </Stack>
        ) : (
          <Chip
            label="Disponível em breve"
            sx={{ fontWeight: 700, flexShrink: 0 }}
          />
        )}
      </Stack>

      {naoAssinado && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Na instalação o Windows vai avisar que não reconhece o programa. É
          esperado: clique em <strong>Mais informações</strong> e depois em{' '}
          <strong>Executar assim mesmo</strong>.
        </Alert>
      )}
    </Card>
  );
}
