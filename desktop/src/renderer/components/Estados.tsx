import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * Os três estados que nenhuma tela deste app pode pular: carregando, vazio e
 * com erro.
 *
 * Estão num arquivo só porque a regra é do produto, não de cada tela: quem
 * está no ar não pode olhar para um retângulo cinza e ter que adivinhar se o
 * copiloto morreu ou se ainda não começou. Todo estado diz O QUE está
 * acontecendo e, quando existe uma saída, oferece o botão dela na mesma caixa.
 */

interface CarregandoProps {
  /** Frase no gerúndio: "Procurando suas bases…". */
  readonly texto: string;
}

export function Carregando({ texto }: CarregandoProps): JSX.Element {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
      <CircularProgress size={26} />
      <Typography variant="body2" color="text.secondary">
        {texto}
      </Typography>
    </Stack>
  );
}

interface AvisoProps {
  readonly titulo: string;
  readonly descricao: string;
  readonly acao?: { readonly rotulo: string; readonly aoClicar: () => void };
  readonly tom?: 'neutro' | 'erro';
  readonly icone?: ReactNode;
}

/**
 * Caixa de estado vazio ou de erro.
 *
 * O tom muda a moldura, não o tamanho: um erro no meio da live não pode roubar
 * a tela inteira das respostas que ainda estão valendo.
 */
export function Aviso({
  titulo,
  descricao,
  acao,
  tom = 'neutro',
  icone,
}: AvisoProps): JSX.Element {
  const erro = tom === 'erro';
  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 3,
        border: '1px dashed',
        borderColor: erro ? 'error.main' : 'divider',
        bgcolor: erro ? 'rgba(220,38,38,0.04)' : 'rgba(22,24,35,0.02)',
      }}
    >
      <Stack spacing={1} alignItems="flex-start">
        {icone ? <Box sx={{ color: erro ? 'error.main' : 'text.secondary' }}>{icone}</Box> : null}
        <Typography variant="subtitle1" fontWeight={800} color={erro ? 'error.main' : 'text.primary'}>
          {titulo}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {descricao}
        </Typography>
        {acao ? (
          <Button
            size="small"
            variant={erro ? 'outlined' : 'contained'}
            color={erro ? 'error' : 'primary'}
            onClick={acao.aoClicar}
            sx={{ mt: 0.5 }}
          >
            {acao.rotulo}
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}
