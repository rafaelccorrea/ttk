import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Box, Button, Stack, Typography, alpha } from '@mui/material';
import { useState } from 'react';
import type { LiveReplyEvent } from '@shared/live-events';
import { cores } from '../theme/theme';

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
        bgcolor: copiado ? alpha(cores.sucesso, 0.06) : cores.superficie,
        border: '1px solid',
        borderColor: copiado ? alpha(cores.sucesso, 0.35) : 'divider',
        // Já usada continua legível, só perde o destaque: no escuro derrubar a
        // opacidade para 0.7 apagaria o texto de vez.
        transition: 'border-color .2s ease, background-color .2s ease',
        '&:hover': { borderColor: copiado ? alpha(cores.sucesso, 0.45) : cores.bordaForte },
      }}
    >
      <Typography
        variant="body2"
        sx={{ lineHeight: 1.55, fontSize: 14.5, color: copiado ? 'text.secondary' : 'text.primary' }}
      >
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
        {/*
          Confiança e latência viram números tabulares: numa lista que recebe
          item a cada poucos segundos, dígitos de largura variável fazem a
          coluna dançar a cada resposta nova.
        */}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}
        >
          {Math.round(resposta.confidence * 100)}% · {Math.round(resposta.latencyMs / 100) / 10}s
        </Typography>
      </Stack>
    </Box>
  );
}
