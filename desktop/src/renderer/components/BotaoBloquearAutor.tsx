import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import { Chip, IconButton, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';

/**
 * O "bloquear autor" de um card, com um clique.
 *
 * Um componente só para os dois cards (escalação e resposta) porque o estado
 * é o mesmo nos dois: ícone → "autor bloqueado" ou o motivo da recusa. Fica no
 * canto e pequeno de propósito — é o gesto raro do cockpit, e um botão grande
 * ao lado de "Copiar" seria clicado por engano no meio da live.
 *
 * Não pede confirmação: o bloqueio é local e desfaz-se em Ajustes. E o card só
 * conhece o `authorHash` — o @ é resolvido no processo principal e nunca chega
 * aqui, nem quando dá certo.
 */
export function BotaoBloquearAutor({
  authorHash,
  aoBloquear,
}: {
  readonly authorHash: string;
  readonly aoBloquear: (
    authorHash: string,
  ) => Promise<{ ok: boolean; motivo?: string }>;
}): JSX.Element | null {
  const [estado, setEstado] = useState<
    { tipo: 'parado' } | { tipo: 'pedindo' } | { tipo: 'bloqueado' } | { tipo: 'falhou'; motivo: string }
  >({ tipo: 'parado' });

  // Evento antigo (de antes do campo existir) ou mensagem sem autor: sem hash
  // não há quem bloquear, e um botão que sempre falha é pior que nenhum.
  if (!authorHash) return null;

  if (estado.tipo === 'bloqueado') {
    return (
      <Chip
        size="small"
        variant="outlined"
        color="default"
        icon={<BlockOutlinedIcon fontSize="small" />}
        label="autor bloqueado"
      />
    );
  }

  if (estado.tipo === 'falhou') {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
        {estado.motivo}
      </Typography>
    );
  }

  return (
    <Tooltip title="Bloquear quem escreveu — as próximas mensagens dele são ignoradas">
      <span>
        <IconButton
          size="small"
          aria-label="Bloquear autor"
          disabled={estado.tipo === 'pedindo'}
          onClick={() => {
            setEstado({ tipo: 'pedindo' });
            void aoBloquear(authorHash)
              .then((r) =>
                setEstado(
                  r.ok
                    ? { tipo: 'bloqueado' }
                    : { tipo: 'falhou', motivo: r.motivo ?? 'Não consegui bloquear.' },
                ),
              )
              .catch(() => setEstado({ tipo: 'falhou', motivo: 'Não consegui bloquear.' }));
          }}
          sx={{ color: 'text.secondary' }}
        >
          <BlockOutlinedIcon fontSize="inherit" />
        </IconButton>
      </span>
    </Tooltip>
  );
}
