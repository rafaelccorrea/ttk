import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Alert, Button, IconButton, Snackbar } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Wallet } from '@/services/billing.service';

const MARCOS = [50, 75, 100] as const;
type Marco = (typeof MARCOS)[number];

/** Um aviso por marco, por ciclo — a chave carrega o início do ciclo. */
function chave(email: string, desde: string | null, marco: Marco) {
  return `pikpok:consumo:${email}:${desde ?? 'sem-ciclo'}:${marco}`;
}

function jaAvisou(k: string) {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}
function marcar(k: string) {
  try {
    localStorage.setItem(k, '1');
  } catch {
    /* sem storage, o aviso só repete — nunca some */
  }
}

/**
 * Avisa quando o consumo do ciclo cruza 50%, 75% e 100%.
 *
 * O caso que motivou: uma conta free gastou os 25 créditos de boas-vindas em
 * três roteiros seguidos e só percebeu no 402. O saldo estava no cabeçalho o
 * tempo todo — mas um número que ninguém mandou olhar é um número invisível.
 *
 * Tom: informa e aponta a saída, nunca repreende. Quem usou 75% produziu
 * bastante; o aviso é "faltam X, dá para tantos roteiros", não "cuidado".
 * Cada marco aparece UMA vez por ciclo (localStorage), e some sozinho.
 */
export function ConsumoToast({
  carteira,
  email,
}: {
  carteira: Wallet | null;
  email: string | null;
}) {
  const [aberto, setAberto] = useState<Marco | null>(null);

  const consumo = carteira?.consumo;
  const pct = consumo?.percentual ?? 0;
  const desde = consumo?.desde ?? null;

  useEffect(() => {
    if (!carteira || carteira.unlimited || !consumo || !email) return;
    // Do maior para o menor: se pulou de 40% para 100% num gasto só, mostra
    // o 100 (o que importa agora) e marca os anteriores como vistos.
    const alcancados = MARCOS.filter((m) => pct >= m);
    const pendente = [...alcancados].reverse().find((m) => !jaAvisou(chave(email, desde, m)));
    if (!pendente) return;
    alcancados.forEach((m) => marcar(chave(email, desde, m)));
    setAberto(pendente);
  }, [carteira, consumo, email, pct, desde]);

  if (!aberto || !consumo) return null;

  const custoRoteiro = carteira?.prices?.script?.credits ?? 8;
  const roteiros = Math.floor(consumo.restantes / custoRoteiro);
  const semPlano = carteira?.plan === 'free';

  const conteudo: Record<Marco, { severidade: 'info' | 'warning' | 'error'; texto: string }> = {
    50: {
      severidade: 'info',
      texto: `Você já usou metade dos seus créditos (${consumo.usados} de ${consumo.concedidos}). Restam ${consumo.restantes} — dá para mais ${roteiros} ${roteiros === 1 ? 'roteiro' : 'roteiros'}.`,
    },
    75: {
      severidade: 'warning',
      texto: `Faltam ${consumo.restantes} créditos (${100 - pct}% do ciclo). Cada roteiro custa ${custoRoteiro}; editar um roteiro já gerado não custa nada.`,
    },
    100: {
      severidade: 'error',
      texto: semPlano
        ? 'Seus créditos de boas-vindas acabaram. Tudo o que você gerou continua salvo — assine um plano para seguir criando.'
        : 'Seus créditos deste ciclo acabaram. Tudo o que você gerou continua salvo — recarregue quando quiser.',
    },
  };
  const { severidade, texto } = conteudo[aberto];

  return (
    <Snackbar
      open
      autoHideDuration={aberto === 100 ? null : 12000}
      onClose={(_, motivo) => motivo !== 'clickaway' && setAberto(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        severity={severidade}
        variant="filled"
        sx={{ maxWidth: 560, alignItems: 'center', fontWeight: 500 }}
        action={
          <>
            <Button
              component={Link}
              to="/planos"
              color="inherit"
              size="small"
              onClick={() => setAberto(null)}
              sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              {aberto === 100 ? (semPlano ? 'Ver planos' : 'Recarregar') : 'Ver saldo'}
            </Button>
            <IconButton size="small" color="inherit" onClick={() => setAberto(null)} aria-label="Fechar">
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </>
        }
      >
        {texto}
      </Alert>
    </Snackbar>
  );
}
