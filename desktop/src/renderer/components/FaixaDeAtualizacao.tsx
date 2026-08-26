import DownloadIcon from '@mui/icons-material/DownloadingOutlined';
import RestartIcon from '@mui/icons-material/RestartAlt';
import { Box, Button, LinearProgress, Stack, Typography, alpha } from '@mui/material';
import { cores } from '../theme/theme';
import { obterPonte } from '../ponte';
import { useEstadoAtualizacao } from '../hooks/useEstadoAtualizacao';

/**
 * A linha que conta que existe uma versão nova — e só isso.
 *
 * Ela é DELIBERADAMENTE a coisa menos urgente da tela. A atualização é baixada
 * sozinha e aplicada sozinha quando o vendedor fechar o app; o botão de
 * reiniciar existe para quem quer agora, não para pedir que seja agora. Um
 * banner grande, um modal ou um "reinicie para continuar" transformariam uma
 * melhoria nossa numa interrupção do trabalho dele — e o trabalho dele, quando
 * este app está aberto, é uma transmissão ao vivo que não pausa.
 *
 * Ela aparece assim que a versão nova é RECONHECIDA (`baixando`, com o
 * percentual) e continua quando fica `pronta`. Falha não vira pixel: é
 * informação sobre a qual o vendedor não tem nada a fazer.
 */
export function FaixaDeAtualizacao(): JSX.Element | null {
  const ponte = obterPonte();
  const estado = useEstadoAtualizacao();

  if (!ponte) return null;
  if (estado?.situacao !== 'pronta' && estado?.situacao !== 'baixando') return null;

  const baixando = estado.situacao === 'baixando';

  return (
    <Box
      sx={{
        flexShrink: 0,
        borderTop: '1px solid',
        borderColor: alpha(cores.ciano, 0.25),
        bgcolor: alpha(cores.ciano, 0.07),
      }}
    >
      {baixando ? (
        <LinearProgress
          variant="determinate"
          value={estado.progresso ?? 0}
          sx={{ height: 2, bgcolor: alpha(cores.ciano, 0.15) }}
        />
      ) : null}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2.25, py: 0.85 }}>
        <DownloadIcon sx={{ fontSize: 16, color: cores.ciano, flexShrink: 0 }} />
        <Typography variant="caption" sx={{ minWidth: 0, lineHeight: 1.4 }}>
          {baixando ? (
            <>
              Nova versão {estado.versao ?? ''} disponível.{' '}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Baixando em segundo plano… {estado.progresso ?? 0}%
              </Box>
            </>
          ) : (
            <>
              Versão {estado.versao ?? 'nova'} pronta.{' '}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Ela entra sozinha quando você fechar o app.
              </Box>
            </>
          )}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {!baixando ? (
          <Button
            size="small"
            color="inherit"
            startIcon={<RestartIcon sx={{ fontSize: 15 }} />}
            onClick={() => void ponte.instalarAtualizacao()}
            sx={{ flexShrink: 0, py: 0.25 }}
          >
            Reiniciar agora
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}
