import { Chip, CircularProgress } from '@mui/material';
import { LiveOrigin, LiveSessionStatus } from '@/services/live.service';

/**
 * Como cada estado do pipeline aparece para o vendedor.
 *
 * O texto fala do trabalho dele, não do nosso: ninguém que sobe uma live sabe
 * o que é "extraindo". E `dica` existe porque a etapa longa é longa de verdade
 * — sem dizer que leva minutos, uma tela parada em "transcrevendo" é
 * indistinguível de uma tela quebrada, e o vendedor recarrega, sobe de novo e
 * paga duas vezes.
 */
export const STATUS_UI: Record<
  LiveSessionStatus,
  {
    label: string;
    dica: string;
    cor: 'default' | 'info' | 'success' | 'error' | 'warning';
    trabalhando: boolean;
  }
> = {
  rascunho: {
    label: 'Sem gravação',
    dica: 'Envie a gravação da live para montar sua base de conhecimento.',
    cor: 'default',
    trabalhando: false,
  },
  transcrevendo: {
    label: 'Ouvindo sua live',
    dica: 'Estamos transcrevendo tudo que você falou. Leva alguns minutos (bem mais numa live de horas) e pode fechar esta tela — quando voltar, o resultado está aqui.',
    cor: 'info',
    trabalhando: true,
  },
  extraindo: {
    label: 'Montando a base',
    dica: 'Já temos a transcrição e agora estamos separando produtos, preços, objeções e perguntas. Falta pouco.',
    cor: 'info',
    trabalhando: true,
  },
  pronta: {
    label: 'Pronta para revisar',
    dica: 'A base está montada. Confira o que a IA entendeu e corrija o que estiver errado.',
    cor: 'success',
    trabalhando: false,
  },
  erro: {
    label: 'Deu problema',
    dica: 'Não conseguimos terminar o processamento desta live.',
    cor: 'error',
    trabalhando: false,
  },
};

/** Só estes dois estados justificam continuar perguntando ao backend. */
export function estaProcessando(status: LiveSessionStatus): boolean {
  return status === 'transcrevendo' || status === 'extraindo';
}

export function StatusChip({ status }: { status: LiveSessionStatus }) {
  const ui = STATUS_UI[status];
  return (
    <Chip
      size="small"
      color={ui.cor}
      variant={ui.cor === 'default' ? 'outlined' : 'filled'}
      label={ui.label}
      icon={ui.trabalhando ? <CircularProgress size={12} color="inherit" /> : undefined}
      sx={{ fontWeight: 700 }}
    />
  );
}

/**
 * Selo de procedência. É o que separa "a IA ouviu isso" de "eu digitei isso" —
 * a diferença que decide o que o vendedor precisa conferir antes de confiar.
 */
export function OrigemChip({
  origin,
  confidence,
}: {
  origin: LiveOrigin;
  confidence?: string | null;
}) {
  if (origin !== 'ia') {
    return (
      <Chip size="small" variant="outlined" label="Você cadastrou" sx={{ fontWeight: 700 }} />
    );
  }

  const nota = confidence == null ? null : Number(confidence);
  // Abaixo de 0,6 a extração chutou: chamar isso de "revisar" em vermelho é
  // mais honesto do que exibir um número que ninguém sabe interpretar.
  const cor: 'success' | 'warning' = nota != null && nota < 0.6 ? 'warning' : 'success';
  const sufixo = nota != null ? ` · ${Math.round(nota * 100)}% de certeza` : '';
  return (
    <Chip
      size="small"
      color={cor}
      variant="outlined"
      label={`Da live${sufixo}`}
      sx={{ fontWeight: 700 }}
    />
  );
}

// Mora em `services/erros.ts` desde que o Multiplicador precisou dela também.
// Reexportado aqui para não mexer nos imports (e nos testes) que já apontam
// para este módulo.
export { mensagemDeErro } from '@/services/erros';
