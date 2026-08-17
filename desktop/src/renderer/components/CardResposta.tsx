import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import type { LiveReplyEvent } from '@shared/live-events';

/**
 * Uma resposta pronta, de alta confiança.
 *
 * O COPIAR é o elemento mais visível do card, e é de propósito: nesta fase
 * nada vai sozinho para o chat: o vendedor copia e cola com a própria mão. Esse
 * gesto é a única evidência que temos de que a resposta prestava — é ele que o
 * `POST live/replies/:id/copied` registra, e é sobre ele que vamos decidir, com
 * algumas dezenas de lives, se o corte de confiança está no lugar e se vale
 * pagar o modelo caro nas perguntas de preço.
 *
 * O "copiado" fica marcado no card depois do clique porque, numa lista que
 * recebe item novo a cada poucos segundos, o vendedor perde o fio de qual ele
 * já usou.
 */
export function CardResposta({
  resposta,
  aoCopiar,
}: {
  readonly resposta: LiveReplyEvent;
  readonly aoCopiar: () => void | Promise<void>;
}): JSX.Element {
  const [copiado, setCopiado] = useState(false);

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 3,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: copiado ? 'success.main' : 'divider',
        opacity: copiado ? 0.7 : 1,
        transition: 'border-color .2s ease, opacity .2s ease',
      }}
    >
      <Typography variant="body1" sx={{ lineHeight: 1.4 }}>
        {resposta.text}
      </Typography>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.25 }}>
        <Button
          size="small"
          variant={copiado ? 'outlined' : 'contained'}
          color={copiado ? 'success' : 'primary'}
          startIcon={copiado ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
          onClick={() => {
            setCopiado(true);
            void aoCopiar();
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {Math.round(resposta.confidence * 100)}% · {Math.round(resposta.latencyMs / 100) / 10}s
        </Typography>
      </Stack>
    </Box>
  );
}
