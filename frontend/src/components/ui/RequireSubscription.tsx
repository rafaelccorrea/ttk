import { Navigate, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { billingService } from '@/services/billing.service';

/**
 * Paywall na entrada: conta no plano `free` é "cadastro feito, pagamento
 * pendente" — ou assinatura encerrada, que volta ao mesmo estado. Nos dois
 * casos a pessoa não entra nas telas pagas.
 *
 * Para onde ela vai mudou com o modo amostra (`docs/CONTA-FREE.md`). Antes era
 * sempre `/assinatura`, fora do AppLayout — sem menu, sem telas de fundo
 * estourando 403. Agora, se a conta tem amostra, ela vai para `/produtos`: é a
 * única porta que ela pode abrir, e mandá-la para o checkout toda vez que
 * clicasse numa tela paga transformaria o app inteiro num pedido de dinheiro.
 * A tela de assinatura continua a um clique, em todo CTA da amostra.
 *
 * Sem amostra (backend antigo, ou conta em estado que este front não conhece),
 * o comportamento é o de antes: `/assinatura`.
 *
 * Isto é só a UX — a autoridade é o backend, que barra todas as rotas de dado e
 * de IA pelo PlanFeatureGuard.
 *
 * Em erro de rede a decisão é deixar passar: o backend barra de qualquer jeito,
 * e trancar o usuário fora do app por uma falha momentânea de /wallet seria
 * pior do que deixá-lo bater no 403.
 */
export function RequireSubscription() {
  const [destino, setDestino] = useState<'carregando' | 'entra' | '/produtos' | '/assinatura'>(
    'carregando',
  );

  useEffect(() => {
    let active = true;
    billingService
      .wallet()
      .then((w) => {
        if (!active) return;
        if (w.plan !== 'free') return setDestino('entra');
        setDestino(w.freeSample?.active ? '/produtos' : '/assinatura');
      })
      .catch(() => active && setDestino('entra'));
    return () => {
      active = false;
    };
  }, []);

  if (destino === 'carregando') {
    return <BrandLoader label="Verificando sua assinatura..." />;
  }
  if (destino === 'entra') return <Outlet />;
  return <Navigate to={destino} replace />;
}
