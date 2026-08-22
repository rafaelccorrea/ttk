import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { billingService } from '@/services/billing.service';

/** O que o chamador precisa dizer para pedir a confirmação. */
export interface PedidoDeGasto {
  /** A ação na tabela do backend: 'script', 'video', 'assembly'... */
  acao: string;
  /** O que o botão faz, na voz do produto: "Gerar vídeo completo". */
  titulo: string;
  /**
   * Quantas unidades. Existe por causa do lote: o Multiplicador cobra 1 crédito
   * por vídeo, e uma matriz cheia são 150 — o que a pessoa precisa confirmar é
   * o TOTAL, não o preço unitário que não decide nada.
   */
  quantidade?: number;
  /**
   * O total em créditos, quando a tela sabe calculá-lo melhor que
   * `preço × quantidade`.
   *
   * O caso que obrigou isto: enviar uma gravação de live cobra DUAS ações —
   * transcrição por bloco e montagem da base, uma vez. Nenhum preço unitário
   * descreve esse total, e confirmar só metade da conta seria pior do que não
   * confirmar, porque a pessoa aprovaria um número que não é o que vai sair.
   */
  custoTotal?: number;
  /** Uma linha a mais quando o gasto merece contexto ("150 vídeos"). */
  detalhe?: string;
}

/**
 * Prefixo das chaves de "não perguntar de novo".
 *
 * `sessionStorage`, não `localStorage`, e essa é a diferença que importa:
 * a dispensa vale para a sessão de trabalho, não para sempre. Quem marca a
 * caixa está dizendo "estou num lote agora", não "nunca mais me avise" — e
 * ninguém lembra, três semanas depois, de ter desligado o aviso de gasto.
 */
const CHAVE = 'pikpok:confirmar-gasto:';

/**
 * Confirmação antes de gastar crédito.
 *
 * O clique era o gasto: não havia passo entre querer e ter debitado. Para 8
 * créditos isso é um susto pequeno; para os 150 de uma matriz cheia do
 * Multiplicador, é a diferença entre um engano e um prejuízo — e era justamente
 * a tela que não avisava nada.
 *
 * O saldo é buscado NA HORA de abrir, e não reaproveitado da tela: entre carregar
 * a página e clicar cabem outras gerações, em outra aba ou pelo desktop. Um
 * "você ficará com X" calculado sobre saldo velho é pior que não mostrar número
 * nenhum, porque parece preciso.
 *
 * Conta ilimitada não vê diálogo: não há o que confirmar quando nada é debitado,
 * e um aviso de gasto para quem não gasta só ensina a clicar sem ler.
 *
 * Uso:
 *   const { confirmar, dialogo } = useConfirmarGasto();
 *   onClick={async () => {
 *     if (!(await confirmar({ acao: 'video', titulo: 'Gerar vídeo' }))) return;
 *     ...
 *   }}
 *   {dialogo}
 */
export function useConfirmarGasto(): {
  confirmar: (pedido: PedidoDeGasto) => Promise<boolean>;
  dialogo: ReactNode;
} {
  const [pedido, setPedido] = useState<PedidoDeGasto | null>(null);
  const [custo, setCusto] = useState<number | null>(null);
  const [saldo, setSaldo] = useState<number | null>(null);
  const [naoPerguntar, setNaoPerguntar] = useState(false);

  /*
   * A promessa fica numa ref, não no estado.
   *
   * É ela que devolve o `true`/`false` para o `await` de quem chamou, e precisa
   * sobreviver às re-renderizações do diálogo sem provocar outras.
   */
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirmar = useCallback(async (novo: PedidoDeGasto): Promise<boolean> => {
    if (sessionStorage.getItem(CHAVE + novo.acao) === '1') return true;

    /*
     * Falha ao consultar a carteira NÃO bloqueia a ação.
     *
     * Sem rede, o certo é deixar seguir e o backend decidir: ele é a autoridade
     * sobre o saldo e recusa com 402 quando não dá. Barrar aqui transformaria
     * uma oscilação de rede em funcionalidade indisponível.
     */
    let carteira: Awaited<ReturnType<typeof billingService.wallet>> | null = null;
    try {
      carteira = await billingService.wallet();
    } catch {
      return true;
    }
    if (carteira?.unlimited) return true;

    const unitario = carteira?.prices?.[novo.acao]?.credits ?? null;
    setCusto(
      novo.custoTotal ??
        (unitario === null ? null : unitario * (novo.quantidade ?? 1)),
    );
    setSaldo(carteira ? carteira.credits : null);
    setNaoPerguntar(false);
    setPedido(novo);

    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const fechar = (ok: boolean) => {
    if (ok && naoPerguntar && pedido) {
      sessionStorage.setItem(CHAVE + pedido.acao, '1');
    }
    setPedido(null);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const restante = saldo !== null && custo !== null ? saldo - custo : null;
  const naoCobre = restante !== null && restante < 0;

  const dialogo = (
    <Dialog open={Boolean(pedido)} onClose={() => fechar(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{pedido?.titulo}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          {pedido?.detalhe && (
            <Typography color="text.secondary">{pedido.detalhe}</Typography>
          )}
          {custo === null ? (
            <Typography>Esta ação consome créditos da sua conta.</Typography>
          ) : (
            <Typography>
              Custa <strong>{custo}</strong>{' '}
              {custo === 1 ? 'crédito' : 'créditos'}.
              {saldo !== null && (
                <>
                  {' '}
                  Você tem <strong>{saldo}</strong> e ficará com{' '}
                  <strong>{Math.max(0, restante ?? 0)}</strong>.
                </>
              )}
            </Typography>
          )}

          {naoCobre && (
            <Alert severity="warning">
              Seu saldo não cobre este gasto. A geração vai ser recusada — compre
              um pacote em Planos &amp; Créditos antes de continuar.
            </Alert>
          )}

          <FormControlLabel
            control={
              <Checkbox
                checked={naoPerguntar}
                onChange={(e) => setNaoPerguntar(e.target.checked)}
              />
            }
            label="Não perguntar de novo nesta sessão"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={() => fechar(false)}>Cancelar</Button>
        <Button variant="contained" onClick={() => fechar(true)} autoFocus>
          {custo === null ? 'Continuar' : `Continuar · ${custo} créditos`}
        </Button>
      </DialogActions>
    </Dialog>
  );

  return { confirmar, dialogo };
}
