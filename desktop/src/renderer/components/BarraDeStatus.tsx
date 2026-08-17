import PauseCircleIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleIcon from '@mui/icons-material/PlayCircleOutline';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { EstadoConexao } from '@shared/desktop-api';

/**
 * O rodapé que nunca sai da tela.
 *
 * São as três perguntas que o vendedor faz de relance, no meio de uma frase de
 * venda: o copiloto está lendo o chat? quanto tempo ainda tenho? ele está
 * trabalhando ou parou? Cada uma vira um número, não uma frase — texto corrido
 * aqui não é lido por ninguém que esteja ao vivo.
 *
 * O PAUSAR fica junto porque é o botão de emergência: quando o copiloto começa
 * a errar, o vendedor precisa desligá-lo em um toque, sem procurar menu e sem
 * encerrar a transmissão (encerrar devolveria a run e obrigaria a reconectar).
 */
export function BarraDeStatus({
  conexao,
  minutosRestantes,
  respostasPorMinuto,
  pausado,
  aoAlternarPausa,
  aoEncerrar,
}: {
  readonly conexao: EstadoConexao;
  readonly minutosRestantes: number | null;
  readonly respostasPorMinuto: number;
  readonly pausado: boolean;
  readonly aoAlternarPausa: () => void;
  readonly aoEncerrar: () => void;
}): JSX.Element {
  const ativo = conexao.status === 'ativa' && !pausado;

  return (
    <Box
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        px: 2,
        py: 1.25,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={2}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
          <Box
            sx={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: corDoStatus(conexao.status, pausado),
              // A pulsação é o que diferencia "conectado" de uma bolinha verde
              // desenhada numa tela travada.
              animation: ativo ? 'pulsa 1.6s ease-in-out infinite' : 'none',
              '@keyframes pulsa': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.35 },
              },
            }}
          />
          <Typography variant="caption" fontWeight={700} noWrap>
            {rotuloDoStatus(conexao.status, pausado)}
          </Typography>
        </Stack>

        <Indicador
          valor={minutosRestantes === null ? '—' : `${minutosRestantes}`}
          rotulo="min"
          alerta={minutosRestantes !== null && minutosRestantes <= 5}
        />
        <Indicador valor={`${respostasPorMinuto}`} rotulo="resp/min" />

        <Box sx={{ flex: 1 }} />

        <Button
          size="small"
          variant={pausado ? 'contained' : 'outlined'}
          color={pausado ? 'primary' : 'inherit'}
          startIcon={pausado ? <PlayCircleIcon /> : <PauseCircleIcon />}
          onClick={aoAlternarPausa}
        >
          {pausado ? 'Retomar' : 'Pausar'}
        </Button>
        <Button size="small" color="inherit" onClick={aoEncerrar}>
          Encerrar
        </Button>
      </Stack>
    </Box>
  );
}

function Indicador({
  valor,
  rotulo,
  alerta = false,
}: {
  readonly valor: string;
  readonly rotulo: string;
  readonly alerta?: boolean;
}): JSX.Element {
  return (
    <Stack direction="row" alignItems="baseline" spacing={0.5}>
      <Typography
        variant="subtitle2"
        fontWeight={800}
        color={alerta ? 'error.main' : 'text.primary'}
      >
        {valor}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {rotulo}
      </Typography>
    </Stack>
  );
}

function corDoStatus(status: EstadoConexao['status'], pausado: boolean): string {
  if (pausado) return '#f59e0b';
  switch (status) {
    case 'ativa':
      return '#16a34a';
    case 'conectando':
      return '#f59e0b';
    case 'sem_saldo':
    case 'erro':
      return '#dc2626';
    default:
      return '#9a9ba1';
  }
}

function rotuloDoStatus(status: EstadoConexao['status'], pausado: boolean): string {
  if (pausado) return 'Pausado';
  switch (status) {
    case 'ativa':
      return 'Lendo o chat';
    case 'conectando':
      return 'Entrando na live';
    case 'sem_saldo':
      return 'Sem minutos';
    case 'encerrada':
      return 'Live encerrada';
    case 'erro':
      return 'Chat caiu';
    default:
      return 'Fora do ar';
  }
}
