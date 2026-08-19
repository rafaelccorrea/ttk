import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LibraryAddIcon from '@mui/icons-material/LibraryAdd';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import { useState } from 'react';
import type { Escalacao } from '../hooks/useFluxoDaLive';
import { brilho, cores } from '../theme/theme';

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
  replyId,
  aoCopiar,
  aoResponder,
  aoDescartar,
  aoSalvarNaBase,
}: {
  readonly escalacao: Escalacao;
  readonly rascunho: string | null;
  /**
   * A resposta que originou o rascunho. Nulo quando o modelo não chegou a
   * escrever nada — e aí não há o que ensinar à base a partir daqui.
   */
  readonly replyId: string | null;
  readonly aoCopiar: (texto: string) => void;
  readonly aoResponder: () => void;
  readonly aoDescartar: () => void;
  readonly aoSalvarNaBase: (replyId: string, texto: string) => Promise<void>;
}): JSX.Element {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(rascunho ?? '');
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(): Promise<void> {
    if (!replyId || !texto.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await aoSalvarNaBase(replyId, texto.trim());
      setSalvo(true);
      setEditando(false);
    } catch {
      /*
       * O erro fica NA TELA, e não num log. O vendedor acabou de digitar a
       * resposta certa achando que estava ensinando o copiloto; sumir com isso
       * em silêncio é fazê-lo descobrir semanas depois, quando a mesma pergunta
       * escalar de novo.
       */
      setErro('Não deu para salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: 1.75,
        borderRadius: 3.5,
        bgcolor: cores.superficieAlta,
        border: '1px solid',
        borderColor: alpha(cores.vermelho, 0.45),
        // Brilho vermelho por baixo no lugar da borda de 2px: no escuro é a
        // luz que empurra o card para a frente, e ela sangra menos na leitura
        // do que um contorno grosso em volta do texto da pergunta.
        boxShadow: brilho(cores.vermelho, 0.22),
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `linear-gradient(160deg, ${alpha(cores.vermelho, 0.10)} 0%, transparent 45%)`,
        },
        '& > *': { position: 'relative' },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.85 }}>
        <Chip
          size="small"
          label={
            escalacao.repeatCount > 1
              ? `${escalacao.repeatCount} pessoas perguntaram`
              : '1 pessoa perguntou'
          }
          sx={{
            bgcolor: alpha(cores.vermelho, 0.18),
            color: cores.vermelho,
            border: '1px solid',
            borderColor: alpha(cores.vermelho, 0.35),
          }}
        />
        {/*
          A idade esquenta com o tempo: cinza é "acabou de chegar", âmbar é
          "responde logo", vermelho é "essa pergunta já quase morreu". Pergunta
          de live tem prazo de validade de minutos, e a cor conta isso sem o
          vendedor precisar fazer aritmética no meio da frase de venda.
        */}
        <Typography
          variant="caption"
          fontWeight={escalacao.idadeMs >= 120_000 ? 750 : 400}
          sx={{
            color:
              escalacao.idadeMs >= 300_000
                ? cores.vermelho
                : escalacao.idadeMs >= 120_000
                  ? '#f59e0b'
                  : 'text.secondary',
          }}
        >
          {emIdade(escalacao.idadeMs)}
        </Typography>
      </Stack>

      <Typography variant="subtitle1" fontWeight={800} sx={{ lineHeight: 1.35 }}>
        {escalacao.text}
      </Typography>

      {rascunho ? (
        <Box
          sx={{
            mt: 1.25,
            p: 1.25,
            borderRadius: 2.5,
            bgcolor: alpha('#ffffff', 0.045),
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="overline" color="text.secondary" display="block" lineHeight={1.6}>
            rascunho — confira antes de usar
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.25, lineHeight: 1.5 }}>
            {rascunho}
          </Typography>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Não achei essa informação na sua base. Responda com o que você sabe —
          e, se quiser, ensine aqui embaixo para eu já saber na próxima.
        </Typography>
      )}

      {/*
       * O campo de edição é o coração da fase 3.
       *
       * Toda escalação é uma lacuna da base, e o vendedor é a única pessoa que
       * sabe preenchê-la. Antes, a orientação era "acrescente isso na base, no
       * site" — ou seja: pare a live, abra o navegador, ache a base, cadastre.
       * Ninguém faz isso ao vivo, e por isso a lacuna escalava de novo na live
       * seguinte. Ensinar tem que caber em dois cliques, no lugar onde a falta
       * apareceu.
       */}
      {editando ? (
        <Box sx={{ mt: 1.25 }}>
          <TextField
            fullWidth
            multiline
            minRows={2}
            size="small"
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, 2000))}
            placeholder="Como você responde essa pergunta?"
            disabled={salvando}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button
              size="small"
              variant="contained"
              onClick={() => void salvar()}
              disabled={salvando || !texto.trim()}
              startIcon={
                salvando ? <CircularProgress size={14} color="inherit" /> : null
              }
            >
              {salvando ? 'Salvando...' : 'Salvar na base'}
            </Button>
            <Button
              size="small"
              color="inherit"
              onClick={() => setEditando(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
          </Stack>
          {erro ? (
            <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
              {erro}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
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
        <Button
          size="small"
          variant="contained"
          color="success"
          onClick={aoResponder}
          sx={{ boxShadow: brilho(cores.sucesso, 0.25) }}
        >
          Respondi na voz
        </Button>
        {/*
         * Sem `replyId` não há o que promover: o modelo não escreveu nada, e a
         * base só aprende a partir de uma resposta existente. O botão some em
         * vez de aparecer desabilitado — botão morto no meio de uma live é
         * ruído em cima de quem já está sob pressão.
         */}
        {replyId && !salvo ? (
          <Button
            size="small"
            color="inherit"
            startIcon={<LibraryAddIcon fontSize="small" />}
            onClick={() => {
              setTexto(rascunho ?? '');
              setEditando(true);
            }}
            disabled={editando}
          >
            Ensinar
          </Button>
        ) : null}
        {salvo ? (
          <Chip size="small" color="success" label="na base" variant="outlined" />
        ) : null}
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
