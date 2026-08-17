import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import { Box, Stack, Typography, alpha } from '@mui/material';
import type { LiveDeliveryStatus } from '@shared/live-events';
import { cores } from '../theme/theme';

/**
 * O que o app REALMENTE escreveu no chat, em ordem de chegada.
 *
 * O feed existe por um motivo só: no modo automático o vendedor deixa de ver o
 * gesto que antes ele mesmo fazia (copiar e colar), e sem esta lista ele estaria
 * confiando às cegas em algo que fala em nome dele na frente da audiência dele.
 * Aqui ele confere, de relance, o que saiu e o que não saiu.
 *
 * A FALHA É O ITEM MAIS VISÍVEL, e é assim de propósito. Um envio que deu certo
 * não pede nada de ninguém; um que falhou é uma pergunta de cliente que ficou
 * sem resposta no chat — e o vendedor pode salvá-la copiando o texto na mão,
 * desde que descubra a tempo. Falha silenciosa aqui é venda perdida sem ninguém
 * saber por quê.
 */
export function FeedDeEnvios({
  itens,
}: {
  readonly itens: readonly ItemDeEnvio[];
}): JSX.Element {
  if (itens.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1, lineHeight: 1.55 }}>
        Nada enviado ainda. Assim que uma resposta sair para o chat, ela aparece
        aqui com o resultado.
      </Typography>
    );
  }

  return (
    <Stack spacing={1} sx={{ mt: 0.5 }}>
      {itens.map((item) => (
        <LinhaDeEnvio key={item.replyId} item={item} />
      ))}
    </Stack>
  );
}

export interface ItemDeEnvio {
  replyId: string;
  /** A resposta que o copiloto escreveu. */
  texto: string;
  /** A pergunta que a originou, quando o fluxo trouxe o texto original. */
  pergunta: string | null;
  /** 0–1, como vem do modelo. */
  confianca: number;
  status: LiveDeliveryStatus;
  /** O porquê da falha, em português. Só vem preenchido quando falhou. */
  motivo: string | null;
}

function LinhaDeEnvio({ item }: { readonly item: ItemDeEnvio }): JSX.Element {
  const falhou = item.status === 'falhou' || item.status === 'cancelada';

  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: 1.25,
        pl: 1.5,
        borderRadius: 3,
        border: '1px solid',
        borderColor: falhou ? alpha(cores.erro, 0.35) : 'divider',
        bgcolor: falhou ? alpha(cores.erro, 0.07) : cores.superficie,
        // A barra vermelha na lateral é o que faz a falha ser encontrada numa
        // rolagem rápida: o vendedor varre a coluna esquerda, não lê os selos.
        '&::before': falhou
          ? {
              content: '""',
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              bgcolor: cores.erro,
            }
          : undefined,
      }}
    >
      {item.pergunta ? (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          display="block"
          sx={{ fontStyle: 'italic', opacity: 0.85 }}
        >
          “{item.pergunta}”
        </Typography>
      ) : null}

      <Typography variant="body2" sx={{ lineHeight: 1.5, mt: item.pergunta ? 0.5 : 0 }}>
        {item.texto}
      </Typography>

      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.85 }}>
        <Selo status={item.status} />
        <Box sx={{ flex: 1 }} />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}
        >
          {Math.round(item.confianca * 100)}%
        </Typography>
      </Stack>

      {/*
        O motivo fica no card e não num tooltip: "falhou" sem o porquê faz o
        vendedor abrir a live no celular para conferir, no meio da venda.
      */}
      {falhou && item.motivo ? (
        <Typography variant="caption" color="error.main" display="block" sx={{ mt: 0.5 }}>
          {item.motivo} Copie a resposta e cole no chat, se ainda fizer sentido.
        </Typography>
      ) : null}
    </Box>
  );
}

function Selo({ status }: { readonly status: LiveDeliveryStatus }): JSX.Element {
  const { icone, rotulo, cor } = aparencia(status);
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: cor }}>
      {icone}
      <Typography variant="caption" fontWeight={700} color="inherit">
        {rotulo}
      </Typography>
    </Stack>
  );
}

function aparencia(status: LiveDeliveryStatus): {
  icone: JSX.Element;
  rotulo: string;
  cor: string;
} {
  switch (status) {
    case 'enviada':
      return {
        icone: <CheckCircleIcon sx={{ fontSize: 15 }} />,
        rotulo: 'enviada',
        cor: 'success.main',
      };
    case 'falhou':
      return {
        icone: <ErrorOutlineIcon sx={{ fontSize: 15 }} />,
        rotulo: 'não entrou no chat',
        cor: 'error.main',
      };
    case 'cancelada':
      return {
        icone: <ErrorOutlineIcon sx={{ fontSize: 15 }} />,
        rotulo: 'cancelada',
        cor: 'error.main',
      };
    default:
      // `pendente` e `nao_aplica` caem aqui: para o vendedor as duas significam
      // a mesma coisa — ainda não saiu.
      return {
        icone: <HourglassTopIcon sx={{ fontSize: 15 }} />,
        rotulo: 'na fila',
        cor: 'text.secondary',
      };
  }
}
