import PauseCircleIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleIcon from '@mui/icons-material/PlayCircleOutline';
import SendIcon from '@mui/icons-material/Send';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import { Box, Button, Chip, Stack, Switch, Typography, alpha } from '@mui/material';
import type { EstadoConexao, EstadoEnvio } from '@shared/desktop-api';
import { cores } from '../theme/theme';

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
  envio,
  minutosRestantes,
  respostasPorMinuto,
  viewers,
  curtidas,
  pausado,
  aoAlternarPausa,
  aoAlternarModo,
  aoAlternarPausaDoEnvio,
  aoEncerrar,
}: {
  readonly conexao: EstadoConexao;
  readonly envio: EstadoEnvio;
  readonly minutosRestantes: number | null;
  readonly respostasPorMinuto: number;
  /** Espectadores agora; `null` enquanto o webcast não reportou. */
  readonly viewers: number | null;
  /** Curtidas acumuladas na run. */
  readonly curtidas: number;
  readonly pausado: boolean;
  readonly aoAlternarPausa: () => void;
  readonly aoAlternarModo: () => void;
  readonly aoAlternarPausaDoEnvio: () => void;
  readonly aoEncerrar: () => void;
}): JSX.Element {
  const ativo = conexao.status === 'ativa' && !pausado;
  const automatico = envio.modo === 'auto';
  const enviando = automatico && !envio.pausado;

  return (
    <Box
      sx={{
        position: 'relative',
        borderTop: '1px solid',
        borderColor: enviando ? alpha(cores.sucesso, 0.30) : 'divider',
        // A barra inteira muda de cor quando o app está escrevendo no chat. É o
        // sinal periférico que o vendedor capta sem ler nada — e é a diferença
        // entre "o copiloto está me ajudando" e "o copiloto está falando com os
        // meus clientes agora".
        bgcolor: enviando ? alpha(cores.sucesso, 0.09) : cores.superficie,
        // No escuro a mudança de fundo sozinha é sutil demais para ser captada
        // pelo canto do olho: um fio verde aceso na borda de cima é o que
        // realmente muda o "clima" da barra.
        boxShadow: enviando ? `0 -8px 28px ${alpha(cores.sucesso, 0.14)}` : 'none',
        transition: 'background-color .3s ease, border-color .3s ease, box-shadow .3s ease',
        px: 2,
        py: 1.25,
        flexShrink: 0,
      }}
    >
      {/* --------------------------------------------- a chave do modo, no topo */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Switch
          size="small"
          checked={automatico}
          onChange={aoAlternarModo}
          color="success"
          inputProps={{ 'aria-label': 'Enviar respostas automaticamente no chat' }}
        />
        <Stack sx={{ minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Typography
              variant="caption"
              fontWeight={800}
              noWrap
              sx={{
                letterSpacing: '0.08em',
                fontSize: 11,
                color: automatico ? cores.sucesso : 'text.secondary',
              }}
            >
              {automatico ? 'ENVIANDO NO CHAT' : 'SÓ NO PAINEL'}
            </Typography>
            {automatico && envio.pausado ? (
              <Chip size="small" color="warning" label="pausado" sx={{ height: 18 }} />
            ) : null}
          </Stack>
          {/*
            Uma linha, e só quando o automático está ligado: é a promessa
            concreta do que vai acontecer no chat de quem está assistindo.
          */}
          <Typography variant="caption" color="text.secondary" noWrap>
            {automatico
              ? `1 resposta a cada ${envio.cadenciaSegundos}s, no máximo ${envio.maxPorMinuto} por minuto.`
              : 'As respostas ficam aqui para você copiar. Nada vai ao chat.'}
          </Typography>
        </Stack>

        <Box sx={{ flex: 1 }} />

        {/*
          O botão de parar o envio fica SEMPRE na tela quando o automático está
          ligado — inclusive já pausado, para o vendedor ver que existe caminho
          de volta. O atalho vem escrito junto porque ele é o que serve com o
          foco no TikTok, que é onde o foco vai estar.
        */}
        {automatico ? (
          <Button
            size="small"
            variant={envio.pausado ? 'outlined' : 'contained'}
            color={envio.pausado ? 'success' : 'error'}
            startIcon={envio.pausado ? <SendIcon /> : <StopCircleIcon />}
            onClick={aoAlternarPausaDoEnvio}
          >
            {envio.pausado ? 'Voltar a enviar' : 'Parar envio (Ctrl+Shift+P)'}
          </Button>
        ) : null}
      </Stack>

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
          // Dois degraus: âmbar avisa com tempo de comprar; vermelho é urgência.
          tom={
            minutosRestantes === null
              ? 'ok'
              : minutosRestantes <= 5
                ? 'critico'
                : minutosRestantes <= 15
                  ? 'atencao'
                  : 'ok'
          }
        />
        <Indicador valor={`${respostasPorMinuto}`} rotulo="resp/min" />
        {/* O placar da live: o vendedor não precisa da tela do TikTok para
            saber se a sala cresce — os números moram no mesmo relance. */}
        {viewers !== null ? (
          <Indicador valor={compacto(viewers)} rotulo="assistindo" />
        ) : null}
        {curtidas > 0 ? <Indicador valor={compacto(curtidas)} rotulo="curtidas" /> : null}

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
  tom = 'ok',
}: {
  readonly valor: string;
  readonly rotulo: string;
  readonly tom?: 'ok' | 'atencao' | 'critico';
}): JSX.Element {
  return (
    <Stack direction="row" alignItems="baseline" spacing={0.5}>
      <Typography
        variant="subtitle2"
        fontWeight={800}
        color={
          tom === 'critico' ? 'error.main' : tom === 'atencao' ? '#f59e0b' : 'text.primary'
        }
      >
        {valor}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {rotulo}
      </Typography>
    </Stack>
  );
}

/** 1.2k em vez de 1234: o rodapé é lido de relance, não somado. */
function compacto(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`;
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
