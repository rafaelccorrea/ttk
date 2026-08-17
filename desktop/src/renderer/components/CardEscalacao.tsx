import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import type { Escalacao } from '../hooks/useFluxoDaLive';

/**
 * Uma pergunta que o copiloto NÃO sustentou.
 *
 * Este card é a razão de o painel existir. A resposta que a IA acertou o
 * vendedor copia e segue; a que ela não acertou é a que faz alguém desistir da
 * compra, e é ela que precisa saltar da tela. Por isso a moldura é a mais forte
 * do cockpit e o card mora no topo, acima de tudo o que já deu certo.
 *
 * O rascunho vem junto, mesmo sendo o texto de que a IA duvidou: quase sempre
 * ele está a uma palavra de servir, e ler um rascunho ruim custa dois segundos
 * — enquanto escrever do zero, ao vivo, custa a venda.
 */
export function CardEscalacao({
  escalacao,
  rascunho,
  aoCopiar,
  aoResponder,
  aoDescartar,
}: {
  readonly escalacao: Escalacao;
  readonly rascunho: string | null;
  readonly aoCopiar: (texto: string) => void;
  readonly aoResponder: () => void;
  readonly aoDescartar: () => void;
}): JSX.Element {
  return (
    <Box
      sx={{
        p: 1.75,
        borderRadius: 3,
        bgcolor: 'background.paper',
        border: '2px solid',
        borderColor: 'primary.main',
        boxShadow: '0 6px 20px rgba(254,44,85,0.14)',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
        <Chip
          size="small"
          color="primary"
          label={
            escalacao.repeatCount > 1
              ? `${escalacao.repeatCount} pessoas perguntaram`
              : '1 pessoa perguntou'
          }
        />
        <Typography variant="caption" color="text.secondary">
          {emIdade(escalacao.idadeMs)}
        </Typography>
      </Stack>

      <Typography variant="subtitle1" fontWeight={800} sx={{ lineHeight: 1.3 }}>
        {escalacao.text}
      </Typography>

      {rascunho ? (
        <Box
          sx={{
            mt: 1,
            p: 1.25,
            borderRadius: 2,
            bgcolor: 'rgba(22,24,35,0.04)',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            rascunho — confira antes de usar
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            {rascunho}
          </Typography>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Não achei essa informação na sua base. Responda com o que você sabe e
          depois acrescente isso na base, no site.
        </Typography>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        {rascunho ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<ContentCopyIcon fontSize="small" />}
            onClick={() => aoCopiar(rascunho)}
          >
            Copiar
          </Button>
        ) : null}
        <Button size="small" variant="contained" onClick={aoResponder}>
          Respondi na voz
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" color="inherit" onClick={aoDescartar}>
          Descartar
        </Button>
      </Stack>
    </Box>
  );
}

/** "agora", "há 2 min" — quem está ao vivo não lê horário. */
function emIdade(ms: number): string {
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos === 1) return 'há 1 min';
  return `há ${minutos} min`;
}
