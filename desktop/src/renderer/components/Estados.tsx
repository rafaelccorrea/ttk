import { Box, Button, Stack, Typography, alpha } from '@mui/material';
import type { ReactNode } from 'react';
import { cores } from '../theme/theme';

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
    <Stack alignItems="center" spacing={2} sx={{ py: 6 }}>
      {/*
        Um anel girando desenhado à mão, e não o `CircularProgress`: o spinner
        de fábrica é um arco monocromático que aparece igual em todo app
        Electron. Este usa o gradiente da marca via `mask`, que recorta um anel
        de dentro do quadrado colorido.
      */}
      <Box
        aria-hidden
        sx={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: `conic-gradient(from 0deg, transparent 0deg, ${cores.vermelho} 200deg, ${cores.ciano} 340deg)`,
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)',
          animation: 'gira 900ms linear infinite',
          '@keyframes gira': { to: { transform: 'rotate(360deg)' } },
          '@media (prefers-reduced-motion: reduce)': { animationDuration: '2.4s' },
        }}
      />
      <Typography variant="body2" color="text.secondary" textAlign="center">
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
 * a tela inteira das respostas que ainda estão valendo. No escuro o que marca
 * o erro é uma barra vertical acesa na lateral — borda tracejada some no preto
 * e vermelho no fundo inteiro gritaria mais do que o problema merece.
 */
export function Aviso({
  titulo,
  descricao,
  acao,
  tom = 'neutro',
  icone,
}: AvisoProps): JSX.Element {
  const erro = tom === 'erro';
  const cor = erro ? cores.erro : cores.ciano;
  return (
    <Box
      sx={{
        position: 'relative',
        p: 2,
        pl: 2.25,
        borderRadius: 3,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: erro ? alpha(cores.erro, 0.30) : 'divider',
        bgcolor: erro ? alpha(cores.erro, 0.07) : alpha('#ffffff', 0.03),
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          bgcolor: cor,
        },
      }}
    >
      <Stack spacing={0.85} alignItems="flex-start">
        {icone ? <Box sx={{ color: cor, display: 'flex' }}>{icone}</Box> : null}
        <Typography variant="subtitle2" fontWeight={800} color={erro ? cores.erro : 'text.primary'}>
          {titulo}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
          {descricao}
        </Typography>
        {acao ? (
          <Button
            size="small"
            variant={erro ? 'outlined' : 'contained'}
            color={erro ? 'error' : 'primary'}
            onClick={acao.aoClicar}
            sx={{ mt: 0.75 }}
          >
            {acao.rotulo}
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}
